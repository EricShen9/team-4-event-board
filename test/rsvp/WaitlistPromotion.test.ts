import { CreateLoggingService } from "../../src/service/LoggingService";
import { CreateInMemoryRSVPRepository } from "../../src/repository/InMemoryRSVPRepository";
import { CreateInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import { CreateRSVPService } from "../../src/service/RSVPService";
import type { IEvent, IRSVP } from "../../src/repository/EventRepository";

describe("RSVPService waitlist promotion", () => {
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
      capacity: 1,
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

  it("promotes the earliest waitlisted RSVP when a going RSVP is cancelled", async () => {
    const { service, rsvpRepository, eventRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent());

    const going = makeRSVP({
      id: "rsvp-going",
      userId: "user-going",
      status: "going",
      createdAt: "2026-04-20T10:00:00.000Z",
    });

    const waitlistedFirst = makeRSVP({
      id: "rsvp-wait-1",
      userId: "user-wait-1",
      status: "waitlisted",
      createdAt: "2026-04-20T10:01:00.000Z",
    });

    const waitlistedSecond = makeRSVP({
      id: "rsvp-wait-2",
      userId: "user-wait-2",
      status: "waitlisted",
      createdAt: "2026-04-20T10:02:00.000Z",
    });

    await rsvpRepository.addRSVP(going);
    await rsvpRepository.addRSVP(waitlistedFirst);
    await rsvpRepository.addRSVP(waitlistedSecond);

    const result = await service.cancelRSVPWithPromotion("event-1", "user-going");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.cancelled.status).toBe("cancelled");
    expect(result.value.promoted).toBeDefined();
    expect(result.value.promoted?.id).toBe("rsvp-wait-1");
    expect(result.value.promoted?.status).toBe("going");

    const firstCheck = await rsvpRepository.getRSVPByUserAndEvent("user-wait-1", "event-1");
    const secondCheck = await rsvpRepository.getRSVPByUserAndEvent("user-wait-2", "event-1");
    const cancelledCheck = await rsvpRepository.getRSVPByUserAndEvent("user-going", "event-1");

    expect(firstCheck.ok).toBe(true);
    expect(secondCheck.ok).toBe(true);
    expect(cancelledCheck.ok).toBe(true);

    if (firstCheck.ok && secondCheck.ok && cancelledCheck.ok) {
      expect(firstCheck.value?.status).toBe("going");
      expect(secondCheck.value?.status).toBe("waitlisted");
      expect(cancelledCheck.value?.status).toBe("cancelled");
    }
  });

  it("does not promote anyone when the waitlist is empty", async () => {
    const { service, rsvpRepository, eventRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent());

    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "rsvp-going",
        userId: "user-going",
        status: "going",
      }),
    );

    const result = await service.cancelRSVPWithPromotion("event-1", "user-going");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.cancelled.status).toBe("cancelled");
    expect(result.value.promoted).toBeUndefined();
  });

  it("calculates waitlist positions in createdAt order", async () => {
    const { service, rsvpRepository, eventRepository } = makeService();

    await eventRepository.addEvent(makeFutureEvent());

    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "wait-1",
        userId: "user-1",
        status: "waitlisted",
        createdAt: "2026-04-20T10:01:00.000Z",
      }),
    );

    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "wait-2",
        userId: "user-2",
        status: "waitlisted",
        createdAt: "2026-04-20T10:02:00.000Z",
      }),
    );

    await rsvpRepository.addRSVP(
      makeRSVP({
        id: "wait-3",
        userId: "user-3",
        status: "waitlisted",
        createdAt: "2026-04-20T10:03:00.000Z",
      }),
    );

    const position1 = await service.getWaitlistPosition("event-1", "user-1");
    const position2 = await service.getWaitlistPosition("event-1", "user-2");
    const position3 = await service.getWaitlistPosition("event-1", "user-3");
    const missing = await service.getWaitlistPosition("event-1", "user-999");

    expect(position1.ok).toBe(true);
    expect(position2.ok).toBe(true);
    expect(position3.ok).toBe(true);
    expect(missing.ok).toBe(true);

    if (position1.ok) expect(position1.value).toBe(1);
    if (position2.ok) expect(position2.value).toBe(2);
    if (position3.ok) expect(position3.value).toBe(3);
    if (missing.ok) expect(missing.value).toBeNull();
  });
});