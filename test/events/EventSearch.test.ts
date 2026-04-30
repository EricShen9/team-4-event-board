import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

describe("GET /events/search — event search", () => {
    const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  });

  const prisma = new PrismaClient({ adapter });
  let app: Express;

  beforeAll(() => {
    app = createComposedApp().getExpressApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function loginAs(email: string, password: string) {
    const agent = request.agent(app);
    await agent.post("/login").type("form").send({ email, password });
    return agent;
  }

  function validPayload(overrides: Record<string, string> = {}) {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const dayAfter = new Date(Date.now() + 2 * 86_400_000);
    return {
      title: "Search Test Event",
      description: "A detailed description for search testing",
      location: "Campus Center",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      ...overrides,
    };
  }

   async function createDraftEvent(
    agent: ReturnType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    const baseTitle = overrides.title ?? "Search Test Event";
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

    return String(event.id);
  }

    async function createPublishedEvent(
    agent: ReturnType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    const id = await createDraftEvent(agent, overrides);
    await agent.post(`/events/${id}/publish`);
    return id;
  }
  describe("authentication", () => {
    it("redirects unauthenticated users to login", async () => {
      const res = await request(app).get("/events/search");

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/login");
    });
  });

  describe("matching results", () => {
    it("matches event title", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(staffAgent, {
        title: "Robotics Club Mixer",
        description: "A social event",
        location: "Student Union",
      });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events/search?q=Robotics");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Robotics Club Mixer");
    });

    it("matches event description", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(staffAgent, {
        title: "Career Night",
        description: "Networking with alumni and recruiters",
        location: "Library",
      });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events/search?q=alumni");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Career Night");
    });

    it("matches event location", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(staffAgent, {
        title: "Hackathon Kickoff",
        description: "Opening session",
        location: "Engineering Lab",
      });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events/search?q=Engineering");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Hackathon Kickoff");
    });
  });

  describe("no results", () => {
    it("shows no matching events found when nothing matches", async () => {
      const userAgent = await loginAs("user@app.test", "password123");

      const res = await userAgent.get("/events/search?q=zzzzzzzzzz");

      expect(res.status).toBe(200);
      expect(res.text).toContain("No matching events found.");
    });
  });

  describe("empty query", () => {
    it("returns all published upcoming events when query is empty", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      await createPublishedEvent(staffAgent, {
        title: "Open Search Event One",
      });
      await createPublishedEvent(staffAgent, {
        title: "Open Search Event Two",
      });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get("/events/search?q=");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Open Search Event One");
      expect(res.text).toContain("Open Search Event Two");
    });
  });

  describe("invalid input", () => {
    it("returns 400 for a query longer than 200 characters", async () => {
      const userAgent = await loginAs("user@app.test", "password123");
      const longQuery = "a".repeat(201);

      const res = await userAgent.get(`/events/search?q=${longQuery}`);

      expect(res.status).toBe(400);
      expect(res.text).toContain("Search query must be 200 characters or fewer.");
    });

    it("returns an HTMX partial for invalid input on HX requests", async () => {
      const userAgent = await loginAs("user@app.test", "password123");
      const longQuery = "b".repeat(201);

      const res = await userAgent
        .get(`/events/search?q=${longQuery}`)
        .set("HX-Request", "true");

      expect(res.status).toBe(400);
      expect(res.text).toContain("Search query must be 200 characters or fewer.");
      expect(res.text).toContain('id="search-results"');
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });
});