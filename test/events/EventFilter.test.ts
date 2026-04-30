
import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

describe("GET /events — event list and filter", () => {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  });

  const prisma = new PrismaClient({ adapter });

  afterAll(async () => {
    await prisma.$disconnect();
  });
  let app: Express;

  beforeAll(() => {
    app = createComposedApp().getExpressApp();
  });

    // ── Helpers ────────────────────────────────────────────────────────

  async function loginAs(email: string, password: string) {
    const agent = request.agent(app);
    await agent.post("/login").type("form").send({ email, password });
    return agent;
  }

  function validPayload(overrides: Record<string, string> = {}) {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const dayAfter = new Date(Date.now() + 2 * 86_400_000);
    return {
      title: "Filter Test Event",
      description: "An event for filter testing",
      location: "Filter Hall",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      ...overrides,
    };
  }

  async function createPublishedEvent(
    agent: ReturnType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    const baseTitle = overrides.title ?? "Filter Test Event";
    const uniqueTitle = `${baseTitle} ${crypto.randomUUID()}`;

    const res = await agent
      .post("/events")
      .type("form")
      .send(
        validPayload({
          ...overrides,
          title: uniqueTitle,
        }),
      );

    if (!res.text.includes("Event created successfully")) {
      throw new Error(`Event creation failed: ${res.text.slice(0, 200)}`);
    }

    const event = await prisma.event.findFirst({
      where: {
        title: uniqueTitle,
      },
      orderBy: {
        id: "desc",
      },
    });

    if (!event) {
      throw new Error("Created event not found in Prisma database.");
    }

    await agent.post(`/events/${event.id}/publish`);

    return String(event.id);
  }

    // ── Authentication ─────────────────────────────────────────────────

  describe("authentication", () => {
    it("redirects to login page when the user is not logged in", async () => {
      const res = await request(app).get("/events");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/login");
    });

    it("returns 401 page for unauthenticated HTMX request", async () => {
      const res = await request(app)
        .get("/events")
        .set("HX-Request", "true");
      expect(res.status).toBe(401);
      expect(res.text).toContain("Please log in");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── No filters ───────────────────────────────────────

  describe("no filters", () => {
    it("returns 200 page and shows the event list page", async () => {
      const agent = await loginAs("user@app.test", "password123");
      const res = await agent.get("/events");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Events");
    });

    it("shows published events when no filters are applied", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(agent, { title: "Unfiltered Event", category: "social" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Unfiltered Event");
    });

    it("does not show draft events in the list", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      // Create a draft but don't publish it
      await agent.post("/events").type("form").send(validPayload({ title: "Secret Draft" }));

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events");
      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Secret Draft");
    });
  });

  // ── Category filter ───────────────────────────────────────────────

  describe("category filter", () => {
    it("returns only events matching the selected category", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(agent, { title: "Swim Meet", category: "sports" });
      await createPublishedEvent(agent, { title: "Pottery Showcase", category: "arts" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events?category=sports");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Swim Meet");
      expect(res.text).not.toContain("Pottery Showcase");
    });

    it("returns events for educational category", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(agent, { title: "CICS 326 Exam Review", category: "educational" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events?category=educational");
      expect(res.status).toBe(200);
      expect(res.text).toContain("CICS 326 Exam Review");
    });
  });

  // ── Timeframe filter ──────────────────────────────────────────────

  describe("timeframe filter", () => {
    it("returns events when filtering by upcoming", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(agent, { title: "Upcoming Event" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events?timeframe=upcoming");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Upcoming Event");
    });
  });

  // ── Invalid filter values ─────────────────────────────────────────

  describe("invalid filter values", () => {
    it("shows error for invalid category", async () => {
      const agent = await loginAs("user@app.test", "password123");
      const res = await agent.get("/events?category=fakecategory");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Invalid category");
    });

    it("shows error for invalid timeframe", async () => {
      const agent = await loginAs("user@app.test", "password123");
      const res = await agent.get("/events?timeframe=next_year");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Invalid timeframe");
    });
  });

  // ── Combined filters ──────────────────────────────────────────────

  describe("combined filters", () => {
    it("filters by both category and timeframe", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(agent, { title: "Combined Filter Event", category: "volunteer" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events?category=volunteer&timeframe=upcoming");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Combined Filter Event");
    });
  });

  // ── Edge case ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns all published events when empty filter values are passed", async () => {
      const agent = await loginAs("user@app.test", "password123");
      const res = await agent.get("/events?category=&timeframe=");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Events");
    });
  });
});
