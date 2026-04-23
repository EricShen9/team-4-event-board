import request from "supertest";
import { createComposedApp } from "../../src/composition";

describe("RSVP routes integration", () => {
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

    await agent.post("/events").type("form").send({
      title: "RSVP Test Event",
      description: "created during integration test",
      location: "Campus Center",
      category: "social",
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      capacity: "1",
    });

    const dashboardResponse = await agent.get("/organizer-dashboard");
    const match = dashboardResponse.text.match(/\/events\/([^/"]+)\/publish/);

    if (!match) {
      throw new Error("Could not find created event id on organizer dashboard.");
    }

    const eventId = match[1];

    await agent.post(`/events/${eventId}/publish`);

    return eventId;
  }

  it("redirects unauthenticated GET /my-rsvps to login", async () => {
    const app = makeApp();

    const response = await request(app).get("/my-rsvps");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login");
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
    expect(response.text).toContain("My RSVPs");
    expect(response.text).toContain("Past / Cancelled");
    expect(response.text).toContain("RSVP Test Event");
  });

  it("returns 401 for unauthenticated RSVP toggle requests", async () => {
    const app = makeApp();

    const response = await request(app).post("/events/81/rsvp");

    expect(response.status).toBe(401);
    expect(response.text).toContain("Please log in to continue.");
  });
});