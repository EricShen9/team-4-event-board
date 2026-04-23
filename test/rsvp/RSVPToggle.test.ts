import { CreateLoggingService } from "../../src/service/LoggingService";
import { CreateInMemoryRSVPRepository } from "../../src/repository/InMemoryRSVPRepository";
import { CreateInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import { CreateRSVPService } from "../../src/service/RSVPService";
import type { IEvent, IRSVP } from "../../src/repository/EventRepository";

describe("RSVPService toggleRSVP", () => {
  const logger = CreateLoggingService();

  function makeService() {
    const rsvpRepository = CreateInMemoryRSVPRepository(logger);
    const eventRepository = CreateInMemoryEventRepository(logger);
    const service = CreateRSVPService(rsvpRepository, eventRepository, logger);

    return { service, rsvpRepository, eventRepository };
  }

  function makeFutureEvent(overrides: Partial<IEvent> = {}): IEvent {
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    return {
      id: "event-1",
      organizerId: "staff-1",
      title: "Test Event",
      description: "Test description",
      location: "Campus Center",
      category: "social",
      status: "published",
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      capacity: 2,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...overrides,
    };
  }

  function makeRSVP(overrides: Partial<IRSVP> = {}): IRSVP {
    return {
      id: crypto.randomUUID(),
      eventId: "event-1",
      userId: "user-1",
      status: "going",
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("creates a going RSVP when capacity is available", async () => {
    const { service, eventRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent({ capacity: 2 }));

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.status).toBe("going");
  });

  it("creates a waitlisted RSVP when the event is full", async () => {
    const { service, eventRepository, rsvpRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent({ capacity: 1 }));
    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "existing-going",
        userId: "other-user",
        status: "going",
      }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.status).toBe("waitlisted");
  });

  it("cancels an existing active RSVP", async () => {
    const { service, eventRepository, rsvpRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent());
    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "existing-rsvp",
        userId: "user-1",
        status: "going",
      }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.status).toBe("cancelled");
  });

  it("reactivates a cancelled RSVP as going when space is available", async () => {
    const { service, eventRepository, rsvpRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent({ capacity: 2 }));
    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "cancelled-rsvp",
        userId: "user-1",
        status: "cancelled",
      }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.status).toBe("going");
  });

  it("reactivates a cancelled RSVP as waitlisted when the event is full", async () => {
    const { service, eventRepository, rsvpRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent({ capacity: 1 }));
    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "other-going",
        userId: "other-user",
        status: "going",
      }),
    );
    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "cancelled-rsvp",
        userId: "user-1",
        status: "cancelled",
      }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.status).toBe("waitlisted");
  });

  it("returns RSVPAuthorizationError when a non-member tries to RSVP", async () => {
    const { service, eventRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent());

    const result = await service.toggleRSVP("event-1", "staff-1", "staff");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.value.name).toBe("RSVPAuthorizationError");
    expect(result.value.message).toContain("Only members can RSVP");
  });

  it("returns RSVPStateError for a cancelled event", async () => {
    const { service, eventRepository } = makeService();

    await eventRepository.addEvent(
      makeFutureEvent({ status: "cancelled" }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.value.name).toBe("RSVPStateError");
    expect(result.value.message).toContain("cancelled");
  });

  it("returns RSVPStateError for a past event", async () => {
    const { service, eventRepository } = makeService();
    const now = new Date();

    await eventRepository.addEvent(
      makeFutureEvent({
        status: "published",
        startDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        endDateTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.value.name).toBe("RSVPStateError");
    expect(result.value.message).toContain("past");
  });

  it("returns RSVPStateError for a draft event", async () => {
    const { service, eventRepository } = makeService();

    await eventRepository.addEvent(
      makeFutureEvent({ status: "draft" }),
    );

    const result = await service.toggleRSVP("event-1", "user-1", "user");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.value.name).toBe("RSVPStateError");
    expect(result.value.message).toContain("published");
  });

  it("returns RSVPNotFound when the event does not exist", async () => {
    const { service } = makeService();

    const result = await service.toggleRSVP("missing-event", "user-1", "user");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.value.name).toBe("EventNotFound");
    expect(result.value.message).toContain("not found");
  });
});