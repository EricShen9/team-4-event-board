
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