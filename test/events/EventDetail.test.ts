import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

process.env.DATABASE_URL = "file:./prisma/test.db";

const testAdapter = new PrismaBetterSqlite3({ url: "file:./prisma/test.db" });
const testPrisma = new PrismaClient({ adapter: testAdapter });

describe("GET /events/:id — event detail page", () => {
  let app: Express;

  beforeAll(async () => {
    await testPrisma.event.deleteMany();
    await testPrisma.$executeRawUnsafe("DELETE FROM sqlite_sequence WHERE name='Event'");
    app = createComposedApp().getExpressApp();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
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
      title: "Detail Test Event",
      description: "A test event for the detail page",
      location: "Test Hall",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      ...overrides,
    };
  }

  let nextExpectedId = 1;
  async function createDraftEvent(
    agent: InstanceType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    await agent.post("/events").type("form").send(validPayload(overrides));
    return String(nextExpectedId++);
  }

  async function createPublishedEvent(
    agent: InstanceType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    const id = await createDraftEvent(agent, overrides);
    await agent.post(`/events/${id}/publish`);
    return id;
  }

  // ── Authentication ─────────────────────────────────────────────────

  describe("authentication", () => {
    it("redirects to login when the user is not logged in", async () => {
      const res = await request(app).get("/events/1");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/login");
    });
  });

  // ── Published event ───────────────────────────────────────────────

  describe("published event", () => {
    it("returns 200 and shows event details for a published event", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      const eventId = await createPublishedEvent(agent, { title: "Published Detail Test" });

      const res = await agent.get(`/events/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Published Detail Test");
      expect(res.text).toContain("Test Hall");
      expect(res.text).toContain("social");
    });

    it("any authenticated user can view a published event", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      const eventId = await createPublishedEvent(staffAgent, { title: "Public Event" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get(`/events/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Public Event");
    });
  });

  // ── Event not found ───────────────────────────────────────────────

  describe("event not found", () => {
    it("returns 404 when the event does not exist", async () => {
      const agent = await loginAs("user@app.test", "password123");
      const res = await agent.get("/events/99999");
      expect(res.status).toBe(404);
      expect(res.text).toContain("Event not found");
    });
  });

  // ── Draft visibility ──────────────────────────────────────────────

  describe("draft visibility", () => {
    it("organizer can see their own draft event", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      const eventId = await createDraftEvent(agent, { title: "My Draft Event" });

      const res = await agent.get(`/events/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain("My Draft Event");
    });

    it("admin can see any draft event", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      const eventId = await createDraftEvent(staffAgent, { title: "Staff Draft For Admin" });

      const adminAgent = await loginAs("admin@app.test", "password123");
      const res = await adminAgent.get(`/events/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Staff Draft For Admin");
    });

    it("regular user cannot see a draft event and gets 404", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      const eventId = await createDraftEvent(staffAgent, { title: "Hidden Draft" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get(`/events/${eventId}`);
      expect(res.status).toBe(404);
      expect(res.text).toContain("Event not found");
    });

    it("different staff member cannot see another staff's draft", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      const eventId = await createDraftEvent(staffAgent, { title: "Private Staff Draft" });

      const userAgent = await loginAs("user@app.test", "password123");
      const res = await userAgent.get(`/events/${eventId}`);
      expect(res.status).toBe(404);
      expect(res.text).toContain("Event not found");
    });
  });

  // ── Edge case ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns 200 for empty event ID (hits list route)", async () => {
      const agent = await loginAs("user@app.test", "password123");
      const res = await agent.get("/events/");
      expect(res.status).toBe(200);
    });
  });
});