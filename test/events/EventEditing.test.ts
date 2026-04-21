// test/events/eventEditing.test.ts

import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";

describe("POST /events/:id — event editing", () => {
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

  /**
   * Baseline valid edit payload for seeded event 81 (published, tomorrow).
   * Includes `status` which is required by the edit controller.
   */
  function validEditPayload(overrides: Record<string, string> = {}) {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const dayAfter = new Date(Date.now() + 2 * 86_400_000);
    return {
      title: "Updated Event Title",
      description: "Updated description for testing",
      location: "Updated Hall 202",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      status: "published",
      ...overrides,
    };
  }

  // ── Authentication & Authorization ─────────────────────────────────

  describe("authentication & authorization", () => {
    it("returns 401 when the user is not logged in", async () => {
      const res = await request(app)
        .post("/events/81")
        .type("form")
        .send(validEditPayload());

      expect(res.status).toBe(401);
      expect(res.text).toContain("Please log in");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 403 when the user has the member role", async () => {
      const agent = await loginAs("user@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload());

      expect(res.status).toBe(403);
      expect(res.text).toContain("Only Staff or Admin can modify events");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Event not found ────────────────────────────────────────────────

  describe("event not found", () => {
    it("returns 404 when the event ID does not exist", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/999")
        .type("form")
        .send(validEditPayload());

      expect(res.status).toBe(404);
      expect(res.text).toContain("not found");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Controller validation — required fields ────────────────────────

  describe("required-field validation", () => {
    it("returns 400 when title is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ title: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Title is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when description is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ description: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Description is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when location is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ location: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Location is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when category is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ category: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Category is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when startDateTime is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ startDateTime: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Start date/time is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when endDateTime is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ endDateTime: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("End date/time is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 400 when status is empty", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ status: "" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Status is required");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Controller validation — invalid status value ───────────────────

  describe("invalid status validation", () => {
    it("returns 400 when status is not a recognized value", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ status: "nonexistent" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid status");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Service validation — business rules ────────────────────────────

  describe("business-rule validation", () => {
    it("returns 400 when start is after end", async () => {
      const agent = await loginAs("admin@app.test", "password123");
      const later = new Date(Date.now() + 2 * 86_400_000);
      const earlier = new Date(Date.now() + 86_400_000);

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(
          validEditPayload({
            startDateTime: later.toISOString().slice(0, 16),
            endDateTime: earlier.toISOString().slice(0, 16),
          }),
        );

      expect(res.status).toBe(400);
      expect(res.text).toContain("Event start must be before end time");
    });

    it("returns 400 when start equals end", async () => {
      const agent = await loginAs("admin@app.test", "password123");
      const sameTime = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 16);

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(
          validEditPayload({
            startDateTime: sameTime,
            endDateTime: sameTime,
          }),
        );

      expect(res.status).toBe(400);
      expect(res.text).toContain("Event start must be before end time");
    });

    it("returns 400 when start is in the past", async () => {
      const agent = await loginAs("admin@app.test", "password123");
      const yesterday = new Date(Date.now() - 86_400_000);
      const tomorrow = new Date(Date.now() + 86_400_000);

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(
          validEditPayload({
            startDateTime: yesterday.toISOString().slice(0, 16),
            endDateTime: tomorrow.toISOString().slice(0, 16),
          }),
        );

      expect(res.status).toBe(400);
      expect(res.text).toContain("Event start cannot be before current time");
    });

    it("returns 400 when capacity is zero", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ capacity: "0" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Capacity must be a positive non-zero number");
    });

    it("returns 400 when capacity is negative", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ capacity: "-5" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Capacity must be a positive non-zero number");
    });

    it("returns 400 when capacity is not a number", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ capacity: "abc" }));

      expect(res.status).toBe(400);
      expect(res.text).toContain("Capacity must be a positive non-zero number");
    });
  });

  // ── State validation — EventStateError (409) ───────────────────────

  describe("state validation", () => {
    it("returns 400 when editing a cancelled event", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      // Cancel event 82 first (seeded as published, owned by admin)
      const cancelRes = await agent
        .post("/events/82/cancel")
        .type("form")
        .send({});
      expect(cancelRes.status).toBe(302);

      // Now attempt to edit the cancelled event
      const res = await agent
        .post("/events/82")
        .type("form")
        .send(validEditPayload());

      expect(res.status).toBe(400);
      expect(res.text).toContain("Cannot modify a cancelled event");
      expect(res.text).not.toContain("<!DOCTYPE");
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns 200 with success partial when admin edits a valid event", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ title: "Admin Updated Title" }));

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event modified successfully");
      expect(res.text).toContain("/home");
      expect(res.text).not.toContain("<!DOCTYPE");
    });

    it("returns 200 with success partial when staff edits a valid event", async () => {
      const agent = await loginAs("staff@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ title: "Staff Updated Title" }));

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event modified successfully");
      expect(res.text).toContain("/home");
    });

    it("succeeds when capacity is omitted (unlimited)", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const payload = validEditPayload();
      delete (payload as Record<string, string>).capacity;

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event modified successfully");
    });

    it("succeeds when a valid capacity is provided", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ capacity: "50" }));

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event modified successfully");
    });

    it("succeeds when status is changed to draft", async () => {
      const agent = await loginAs("admin@app.test", "password123");

      const res = await agent
        .post("/events/81")
        .type("form")
        .send(validEditPayload({ status: "draft" }));

      expect(res.status).toBe(200);
      expect(res.text).toContain("Event modified successfully");
    });
  });
});