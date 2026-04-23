import request from "supertest";
import { createComposedApp } from "../../src/composition";

describe("RSVP routes integration", () => {
  function makeApp() {
    return createComposedApp().getExpressApp();
  }

  async function loginAsUser(agent: any) {
    await agent
      .post("/login")
      .type("form")
      .send({
        email: "user@app.test",
        password: "password123",
      });
  }

  async function loginAsStaff(agent: any) {
    await agent
      .post("/login")
      .type("form")
      .send({
        email: "staff@app.test",
        password: "password123",
      });
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
    const agent = request.agent(app);

    await loginAsUser(agent);

    const response = await agent
      .post("/events/81/rsvp")
      .set("Referer", "http://127.0.0.1:3443/events/81");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/events/81");

    const dashboardResponse = await agent.get("/my-rsvps");
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).toContain("HackHer");
  });

  it("returns an HTMX dashboard fragment when cancelling from /my-rsvps", async () => {
    const app = makeApp();
    const agent = request.agent(app);

    await loginAsUser(agent);

    // first RSVP so the dashboard has something to show
    await agent
      .post("/events/81/rsvp")
      .set("Referer", "http://127.0.0.1:3443/events/81");

    const response = await agent
      .post("/events/81/rsvp")
      .set("HX-Request", "true")
      .set("Referer", "http://127.0.0.1:3443/my-rsvps");

    expect(response.status).toBe(200);
    expect(response.text).toContain("My RSVPs");
    expect(response.text).toContain("Past / Cancelled");
    expect(response.text).toContain("HackHer");
  });

  it("returns 401 for unauthenticated RSVP toggle requests", async () => {
    const app = makeApp();

    const response = await request(app).post("/events/81/rsvp");

    expect(response.status).toBe(401);
    expect(response.text).toContain("Please log in to continue.");
  });
});