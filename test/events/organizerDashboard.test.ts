// test/events/organizerDashboard.test.ts

import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const testDatabaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
process.env.DATABASE_URL = testDatabaseUrl;

import { createComposedApp } from "../../src/composition";

const testAdapter = new PrismaBetterSqlite3({ url: testDatabaseUrl });
const testPrisma = new PrismaClient({ adapter: testAdapter });

describe("Organizer Event Dashboard", () => {
  let app: Express;

  beforeAll(async () => {
    await testPrisma.rsvp.deleteMany();
    await testPrisma.event.deleteMany();
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
      title: "Dashboard Test Event",
      description: "A description for dashboard testing",
      location: "Test Hall 101",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      ...overrides,
    };
  }

  /**
   * Create a draft event via POST /events and return its actual Prisma ID.
   */
  async function createDraftEvent(
    agent: ReturnType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    const baseTitle = overrides.title ?? "Dashboard Test Event";
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

    const event = await testPrisma.event.findFirst({
      where: {
        title: uniqueTitle,
      },
      orderBy: {
        id: "desc",
      },
    });

    if (!event) {
      throw new Error(`Event "${uniqueTitle}" not found in database after creation`);
    }

    const id = event.id.toString();

    const detailRes = await agent.get(`/events/${id}`);
    if (detailRes.status !== 200 || !detailRes.text.includes(baseTitle)) {
      throw new Error(
        `Expected event "${baseTitle}" at /events/${id} but got status ${detailRes.status}`,
      );
    }

    return id;
  }

  // ── Access control ─────────────────────────────────────────────────

  describe("access control", () => {
    it("redirects to /login when the user is not logged in", async () => {
      const res = await request(app).get("/organizer-dashboard");

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/login");
    });

    it("returns 403 when the user has the member role", async () => {
      const agent = await loginAs("user@app.test", "password123");

      const res = await agent.get("/organizer-dashboard");

      expect(res.status).toBe(403);
      expect(res.text).toContain("Only Staff or Admin can access the organizer dashboard");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 200 with dashboard page for staff", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Organizer Dashboard");
    });

    it("returns 200 with dashboard page for admin", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Organizer Dashboard");
    });
  });

  // ── Organizer sees only their own events ───────────────────────────

  describe("organizer sees only their own events", () => {
    it("staff dashboard displays events they created", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");

      await createDraftEvent(staffAgent, { title: "Staff Event Alpha" });
      await createDraftEvent(staffAgent, { title: "Staff Event Beta" });

      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Staff Event Alpha");
      expect(res.text).toContain("Staff Event Beta");
    });

    it("staff dashboard does not show events created by other organizers", async () => {
      const adminAgent = await loginAs("admin@app.test", "password123");
      await createDraftEvent(adminAgent, { title: "Admin Secret Event" });

      const staffAgent = await loginAs("staff@app.test", "password123");
      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Admin Secret Event");
      expect(res.text).toContain("Staff Event Alpha");
      expect(res.text).toContain("Staff Event Beta");
    });
  });

  // ── Admin sees all events ──────────────────────────────────────────

  describe("admin sees all events", () => {
    it("admin dashboard shows events from every organizer", async () => {
      const adminAgent = await loginAs("admin@app.test", "password123");

      const res = await adminAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Staff Event Alpha");
      expect(res.text).toContain("Staff Event Beta");
      expect(res.text).toContain("Admin Secret Event");
    });

    it("admin sees newly created staff events without needing to create them", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      await createDraftEvent(staffAgent, { title: "Staff Event Gamma" });

      const adminAgent = await loginAs("admin@app.test", "password123");
      const res = await adminAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Staff Event Gamma");
    });
  });

  // ── Events are grouped by status ──────────────────────────────────

  describe("events are grouped by status", () => {
    it("newly created events appear in the Draft section", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");

      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/Draft \(\d+\)/);
      expect(res.text).toContain("Staff Event Alpha");
    });

    it("published events appear in the Published section", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      const eventId = await createDraftEvent(staffAgent, {
        title: "Staff Published Event",
      });

      await staffAgent.post(`/events/${eventId}/publish`);

      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Staff Published Event");
      expect(res.text).toMatch(/Published \(\d+\)/);
    });

    it("cancelled events appear in the Cancelled / Past section", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");
      const eventId = await createDraftEvent(staffAgent, {
        title: "Staff Cancelled Event",
      });

      await staffAgent.post(`/events/${eventId}/publish`);
      await staffAgent.post(`/events/${eventId}/cancel`);

      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Staff Cancelled Event");
      expect(res.text).toMatch(/Cancelled \/ Past \(\d+\)/);
    });
  });

  describe("dashboard renders inline action controls", () => {
    it("draft events include a Publish button with HTMX attributes", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");

      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Publish Event");
      expect(res.text).toMatch(/hx-post="\/events\/\d+\/publish"/);
      expect(res.text).toMatch(/hx-target="#event-status-controls-\d+"/);
    });

    it("published events include a Cancel button with HTMX confirmation", async () => {
      const staffAgent = await loginAs("staff@app.test", "password123");

      const res = await staffAgent.get("/organizer-dashboard");

      expect(res.status).toBe(200);
      expect(res.text).toContain("Cancel Event");
      expect(res.text).toMatch(/hx-post="\/events\/\d+\/cancel"/);
      expect(res.text).toContain("hx-confirm=");
    });
  });
});