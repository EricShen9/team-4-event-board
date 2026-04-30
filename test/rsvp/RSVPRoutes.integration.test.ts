import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const testDatabaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
process.env.DATABASE_URL = testDatabaseUrl;

import { createComposedApp } from "../../src/composition";

const testAdapter = new PrismaBetterSqlite3({ url: testDatabaseUrl });
const testPrisma = new PrismaClient({ adapter: testAdapter });

describe("RSVP routes integration", () => {
  beforeAll(async () => {
    await testPrisma.rsvp.deleteMany();
    await testPrisma.event.deleteMany();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  function makeApp() {
    return createComposedApp().getExpressApp();
  }

  async function loginAsUser(agent: any) {
    await agent.post("/login").type("form").send({
      email: "user@app.test",
      password: "password123",
    });
  }

  async function loginAsStaff(agent: any) {
    await agent.post("/login").type("form").send({
      email: "staff@app.test",
      password: "password123",
    });
  }

  async function createPublishedEvent(agent: any): Promise<string> {
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const uniqueTitle = `RSVP Test Event ${crypto.randomUUID()}`;

    const createResponse = await agent.post("/events").type("form").send({
      title: uniqueTitle,
      description: "created during integration test",
      location: "Campus Center",
      category: "social",
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      capacity: "1",
    });

    if (!createResponse.text.includes("Event created successfully")) {
      throw new Error(
        `Event creation failed: ${createResponse.text.slice(0, 200)}`,
      );
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
      throw new Error("Could not find created event in Prisma database.");
    }

    const eventId = String(event.id);

    await agent.post(`/events/${eventId}/publish`);

    return eventId;
  }

  it("redirects unauthenticated GET /my-rsvps to login", async () => {
    const app = makeApp();

    const response = await request(app).get("/my-rsvps");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login");
  });

  it("returns 403 when staff tries to RSVP to an event", async () => {
    const app = makeApp();
    const staffAgent = request.agent(app);

    await loginAsStaff(staffAgent);
    const eventId = await createPublishedEvent(staffAgent);

    const response = await staffAgent
      .post(`/events/${eventId}/rsvp`)
      .set("Referer", `http://127.0.0.1:3443/events/${eventId}`);

    expect(response.status).toBe(403);
    expect(response.text).toContain("Only members can RSVP.");
  });

  it("allows an authenticated user to view the RSVP dashboard", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    await loginAsUser(agent);

    const response = await agent.get("/my-rsvps");

    expect(response.status).toBe(200);
    expect(response.text).toContain("My RSVPs");
  });

  it("blocks staff from accessing the member RSVP dashboard", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    await loginAsStaff(agent);

    const response = await agent.get("/my-rsvps");

    expect(response.status).toBe(403);
    expect(response.text).toContain("Only members can access the RSVP dashboard.");
  });

  it("lets a logged-in user toggle RSVP from the event detail flow", async () => {
    const app = makeApp();

    const staffAgent = request.agent(app);
    await loginAsStaff(staffAgent);
    const eventId = await createPublishedEvent(staffAgent);

    const userAgent = request.agent(app);
    await loginAsUser(userAgent);

    const response = await userAgent
      .post(`/events/${eventId}/rsvp`)
      .set("Referer", `http://127.0.0.1:3443/events/${eventId}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`/events/${eventId}`);

    const dashboardResponse = await userAgent.get("/my-rsvps");
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).toContain("RSVP Test Event");
  });

  it("returns an HTMX dashboard fragment when cancelling from /my-rsvps", async () => {
    const app = makeApp();

    const staffAgent = request.agent(app);
    await loginAsStaff(staffAgent);
    const eventId = await createPublishedEvent(staffAgent);

    const userAgent = request.agent(app);
    await loginAsUser(userAgent);

    await userAgent
      .post(`/events/${eventId}/rsvp`)
      .set("Referer", `http://127.0.0.1:3443/events/${eventId}`);

    const response = await userAgent
      .post(`/events/${eventId}/rsvp`)
      .set("HX-Request", "true")
      .set("Referer", "http://127.0.0.1:3443/my-rsvps");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="past-rsvps"');
    expect(response.text).toContain('hx-swap-oob="outerHTML"');
    expect(response.text).toContain("Past / Cancelled");
    expect(response.text).toContain("RSVP Test Event");
    expect(response.text).toContain("cancelled");
    expect(response.text).not.toContain("My RSVPs");
  });

  it("returns 401 for unauthenticated RSVP toggle requests", async () => {
    const app = makeApp();

    const response = await request(app).post("/events/81/rsvp");

    expect(response.status).toBe(401);
    expect(response.text).toContain("Please log in to continue.");
  });
});