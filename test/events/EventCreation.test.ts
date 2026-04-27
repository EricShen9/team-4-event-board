// test/events/eventCreation.test.ts

import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";

process.env.DATABASE_URL = "file:./prisma/test.db";

describe("POST /events — event creation", () => {
  let app: Express;

  beforeAll(() => {
    app = createComposedApp().getExpressApp();
  });

  // ── Helpers ────────────────────────────────────────────────────────

  /** Return a supertest agent with an authenticated session. */
  async function loginAs(email: string, password: string) {
    const agent = request.agent(app);
    await agent.post("/login").type("form").send({ email, password });
    return agent;
  }

  /** Baseline valid form payload — override individual fields per test. */
  function validPayload(overrides: Record<string, string> = {}) {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const dayAfter = new Date(Date.now() + 2 * 86_400_000);
    return {
      title: "Integration Test Event",
      description: "A detailed description for integration testing",
      location: "Test Hall 101",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      ...overrides,
    };
  }

  // ── Authentication & Authorization ─────────────────────────────────

  describe("authentication & authorization", () => {
    it("returns 401 when the user is not logged in", async () => {
      const res = await request(app)
        .post("/events")
        .type("form")
        .send(validPayload());

      expect(res.status).toBe(401);
      expect(res.text).toContain("Please log in");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 403 when the user has the member role", async () => {
      const agent = await loginAs("user@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload());

      expect(res.status).toBe(403);
      expect(res.text).toContain("Only Staff or Admin can create events");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Controller validation — required fields ────────────────────────

  describe("required-field validation", () => {
    it("returns 400 when title is empty", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ title: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Title is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when description is empty", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ description: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Description is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when location is empty", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ location: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Location is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when category is empty", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ category: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Category is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when startDateTime is empty", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ startDateTime: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Start date/time is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when endDateTime is empty", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ endDateTime: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("End date/time is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Service validation — business rules ────────────────────────────

  describe("business-rule validation", () => {
    it("returns 400 when start is after end", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      const later = new Date(Date.now() + 2 * 86_400_000);
      const earlier = new Date(Date.now() + 86_400_000);

      const res = await agent
        .post("/events")
        .type("form")
        .send(
          validPayload({
            startDateTime: later.toISOString().slice(0, 16),
            endDateTime: earlier.toISOString().slice(0, 16),
          }),
        );

      expect(res.status).toBe(400);
      expect(res.text).toContain("Event start must be before end time");
    });

    it("returns 400 when start equals end", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      const sameTime = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 16);

      const res = await agent
        .post("/events")
        .type("form")
        .send(
          validPayload({
            startDateTime: sameTime,
            endDateTime: sameTime,
          }),
        );

      expect(res.status).toBe(400);
      expect(res.text).toContain("Event start must be before end time");
    });

    it("returns 400 when start is in the past", async () => {
      const agent = await loginAs("staff@app.test", "password123");
      const yesterday = new Date(Date.now() - 86_400_000);
      const tomorrow = new Date(Date.now() + 86_400_000);

      const res = await agent
        .post("/events")
        .type("form")
        .send(
          validPayload({
            startDateTime: yesterday.toISOString().slice(0, 16),
            endDateTime: tomorrow.toISOString().slice(0, 16),
          }),
        );

      expect(res.status).toBe(400);
      expect(res.text).toContain(
        "Event start cannot be before current time",
      );
    });

    it("returns 400 when capacity is zero", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ capacity: "0" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain(
        "Capacity must be a positive non-zero number",
      );
    });

    it("returns 400 when capacity is negative", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ capacity: "-5" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain(
        "Capacity must be a positive non-zero number",
      );
    });

    it("returns 400 when capacity is not a number", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ capacity: "abc" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain(
        "Capacity must be a positive non-zero number",
      );
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns 200 with success partial when staff creates a valid event", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload());

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event created successfully");
      expect(res.text).toContain("/home");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 200 with success partial when admin creates a valid event", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ title: "Admin Created Event" }));

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event created successfully");
      expect(res.text).toContain("/home");
    });

    it("succeeds when capacity is omitted (unlimited)", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload());

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event created successfully");
    });

    it("succeeds when a valid capacity is provided", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events")
        .type("form")
        .send(validPayload({ capacity: "100" }));

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event created successfully");
    });
  });
});