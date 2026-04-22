// test/events/eventLifecycle.test.ts

import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";

describe("Event Publishing and Cancellation", () => {
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
      title: "Test Event",
      description: "this is a test",
      location: "UMass",
      category: "social",
      startDateTime: tomorrow.toISOString().slice(0, 16),
      endDateTime: dayAfter.toISOString().slice(0, 16),
      ...overrides,
    };
  }

  /**
   * Create a draft event via POST /events and return its ID.
   * Relies on sequential in-memory ID generation starting at 1.
   * Verifies the event exists at the expected ID before returning.
   */
  let nextExpectedId = 1;
  async function createDraftEvent(
    agent: InstanceType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    const res = await agent
      .post("/events")
      .type("form")
      .send(validPayload(overrides));

    if (!res.text.includes("Event created successfully")) {
      throw new Error(`Event creation failed: ${res.text.slice(0, 200)}`);
    }

    const id = String(nextExpectedId++);

    // Verify the event exists at the expected ID
    const title = overrides.title ?? "Lifecycle Test Event";
    const detailRes = await agent.get(`/events/${id}`);
    if (detailRes.status !== 200 || !detailRes.text.includes(title)) {
      throw new Error(
        `Expected event "${title}" at /events/${id} but got status ${detailRes.status}`,
      );
    }

    return id;
  }

  // ── POST /events/:id/publish ─────────────────────────────────────

  describe("POST /events/:id/publish — event publishing", () => {
    describe("authentication & authorization", () => {
      it("returns 401 when the user is not logged in", async () => {
        const res = await request(app).post("/events/1/publish");

        expect(res.status).toBe(401);
        expect(res.text).toContain("Please log in");
        expect(res.text).not.toContain("<!DOCTYPE");
      });

      it("returns 403 when the user has the member role", async () => {
        const agent = await loginAs("user@app.test", "password123");

        const res = await agent.post("/events/1/publish");

        expect(res.status).toBe(403);
        expect(res.text).toContain("Only Staff or Admin can publish events");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("happy path", () => {
      it("publishes a draft event and returns updated inline status controls", async () => {
        const agent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(agent, { title: "Publish Happy Path" });

        const res = await agent.post(`/events/${eventId}/publish`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("PUBLISHED");
        expect(res.text).toContain("published successfully");
        // After publishing, cancel button should appear
        expect(res.text).toContain("Cancel Event");
        // Publish button should no longer appear
        expect(res.text).not.toContain("Publish Event");
        // Response is an HTMX partial, not a full page
        expect(res.text).toContain('id="event-status-controls"');
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("authorization — service-level ownership check", () => {
      it("returns inline error when admin (non-organizer) tries to publish another user's event", async () => {
        const staffAgent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(staffAgent, { title: "Staff Only Publish" });

        const adminAgent = await loginAs("admin@app.test", "password123");
        const res = await adminAgent.post(`/events/${eventId}/publish`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("Only the event organizer can publish");
        // Event should still be in draft state
        expect(res.text).toContain("DRAFT");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("invalid state transitions", () => {
      it("returns inline error when publishing an already published event", async () => {
        const agent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(agent, { title: "Double Publish" });

        // First publish succeeds
        await agent.post(`/events/${eventId}/publish`);

        // Second publish should fail with state transition error
        const res = await agent.post(`/events/${eventId}/publish`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("Cannot publish an event with status &#34;published&#34;");
        expect(res.text).not.toContain("<!DOCTYPE");
      });

      it("returns inline error when publishing a cancelled event", async () => {
        const agent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(agent, { title: "Publish After Cancel" });

        // Publish then cancel
        await agent.post(`/events/${eventId}/publish`);
        await agent.post(`/events/${eventId}/cancel`);

        // Attempt to publish the cancelled event
        const res = await agent.post(`/events/${eventId}/publish`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("Cannot publish an event with status &#34;cancelled&#34;");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("event not found", () => {
      it("returns error when the event does not exist", async () => {
        const agent = await loginAs("staff@app.test", "password123");

        const res = await agent.post("/events/99999/publish");

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });
  });

  // ── POST /events/:id/cancel ──────────────────────────────────────

  describe("POST /events/:id/cancel — event cancellation", () => {
    describe("authentication & authorization", () => {
      it("returns 401 when the user is not logged in", async () => {
        const res = await request(app).post("/events/1/cancel");

        expect(res.status).toBe(401);
        expect(res.text).toContain("Please log in");
        expect(res.text).not.toContain("<!DOCTYPE");
      });

      it("returns 403 when the user has the member role", async () => {
        const agent = await loginAs("user@app.test", "password123");

        const res = await agent.post("/events/1/cancel");

        expect(res.status).toBe(403);
        expect(res.text).toContain("Only Staff or Admin can cancel events");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("happy path", () => {
      it("organizer cancels their own published event and returns updated inline status controls", async () => {
        const agent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(agent, { title: "Cancel By Organizer" });
        await agent.post(`/events/${eventId}/publish`);

        const res = await agent.post(`/events/${eventId}/cancel`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("CANCELLED");
        expect(res.text).toContain("Event cancelled");
        // Cancelled is a terminal state — no action buttons
        expect(res.text).not.toContain("Publish Event");
        expect(res.text).not.toContain("Cancel Event");
        // Response is an HTMX partial, not a full page
        expect(res.text).toContain('id="event-status-controls"');
        expect(res.text).not.toContain("<!DOCTYPE");
      });

      it("admin cancels another user's published event", async () => {
        const staffAgent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(staffAgent, { title: "Admin Cancels Staff Event" });
        await staffAgent.post(`/events/${eventId}/publish`);

        const adminAgent = await loginAs("admin@app.test", "password123");
        const res = await adminAgent.post(`/events/${eventId}/cancel`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("CANCELLED");
        expect(res.text).toContain("Event cancelled");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("authorization — service-level ownership check", () => {
      it("returns inline error when non-organizer staff tries to cancel", async () => {
        // Admin creates and publishes an event
        const adminAgent = await loginAs("admin@app.test", "password123");
        const eventId = await createDraftEvent(adminAgent, { title: "Staff Cannot Cancel This" });
        await adminAgent.post(`/events/${eventId}/publish`);

        // Staff (non-organizer and not admin) tries to cancel
        const staffAgent = await loginAs("staff@app.test", "password123");
        const res = await staffAgent.post(`/events/${eventId}/cancel`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("Only the event organizer or an admin can cancel");
        // Event should still be published
        expect(res.text).toContain("PUBLISHED");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("invalid state transitions", () => {
      it("returns inline error when cancelling a draft event", async () => {
        const agent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(agent, { title: "Cancel Draft Attempt" });

        // Try to cancel without publishing first
        const res = await agent.post(`/events/${eventId}/cancel`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("Cannot cancel an event with status &#34;draft&#34;");
        expect(res.text).not.toContain("<!DOCTYPE");
      });

      it("returns inline error when cancelling an already cancelled event", async () => {
        const agent = await loginAs("staff@app.test", "password123");
        const eventId = await createDraftEvent(agent, { title: "Double Cancel Attempt" });
        await agent.post(`/events/${eventId}/publish`);
        await agent.post(`/events/${eventId}/cancel`);

        // Second cancel should fail
        const res = await agent.post(`/events/${eventId}/cancel`);

        expect(res.status).toBe(200);
        expect(res.text).toContain("Cannot cancel an event with status &#34;cancelled&#34;");
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });

    describe("event not found", () => {
      it("returns error when the event does not exist", async () => {
        const agent = await loginAs("staff@app.test", "password123");

        const res = await agent.post("/events/99999/cancel");

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.text).not.toContain("<!DOCTYPE");
      });
    });
  });
});