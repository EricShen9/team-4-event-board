
import request from "supertest";
import type { Express } from "express";
import { createComposedApp } from "../../src/composition";

describe("GET /events — event list and filter", () => {
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

  let nextExpectedId = 1;
  async function createPublishedEvent(
    agent: InstanceType<typeof request.agent>,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    await agent.post("/events").type("form").send(validPayload(overrides));
    const id = String(nextExpectedId++);
    await agent.post(`/events/${id}/publish`);
    return id;
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