import { CreateLoggingService } from "../../src/service/LoggingService";
import { CreateInMemoryRSVPRepository } from "../../src/repository/InMemoryRSVPRepository";
import { CreateInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import { CreateRSVPService } from "../../src/service/RSVPService";
import type { IEvent, IRSVP } from "../../src/repository/EventRepository";

describe("RSVPService My RSVPs dashboard", () => {
  const logger = CreateLoggingService();

  function makeService() {
    const rsvpRepository = CreateInMemoryRSVPRepository(logger);
    const eventRepository = CreateInMemoryEventRepository(logger);
    const service = CreateRSVPService(rsvpRepository, eventRepository, logger);

    return { service, rsvpRepository, eventRepository };
  }

  function makeEvent(overrides: Partial<IEvent> = {}): IEvent {
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    return {
      id: crypto.randomUUID(),
      organizerId: "staff-1",
      title: "Event",
      description: "Desc",
      location: "Campus Center",
      category: "social",
      status: "published",
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      capacity: 10,
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

  it("groups upcoming RSVPs separately from past or cancelled ones", async () => {
    const { service, rsvpRepository, eventRepository } = makeService();
    const now = new Date();

    const upcomingEvent = makeEvent({
      id: "upcoming-1",
      title: "Upcoming Event",
      startDateTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      status: "published",
    });

    const pastEvent = makeEvent({
      id: "past-1",
      title: "Past Event",
      startDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      status: "published",
    });

    const cancelledEvent = makeEvent({
      id: "cancelled-1",
      title: "Cancelled Event",
      status: "cancelled",
      startDateTime: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    });

    await eventRepository.addEvent(upcomingEvent);
    await eventRepository.addEvent(pastEvent);
    await eventRepository.addEvent(cancelledEvent);

    await rsvpRepository.addRSVP(
      makeRSVP({ eventId: "upcoming-1", userId: "user-1", status: "going" }),
    );
    await rsvpRepository.addRSVP(
      makeRSVP({ eventId: "past-1", userId: "user-1", status: "going" }),
    );
    await rsvpRepository.addRSVP(
      makeRSVP({ eventId: "cancelled-1", userId: "user-1", status: "going" }),
    );

    const result = await service.getMyRSVPDashboard("user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.upcoming).toHaveLength(1);
    expect(result.value.past).toHaveLength(2);

    expect(result.value.upcoming[0].event.title).toBe("Upcoming Event");
    expect(result.value.past.map((entry) => entry.event.title)).toEqual(
      expect.arrayContaining(["Past Event", "Cancelled Event"]),
    );
  });

  it("sorts upcoming ascending by start time and past descending by start time", async () => {
    const { service, rsvpRepository, eventRepository } = makeService();
    const now = new Date();

    const upcomingLater = makeEvent({
      id: "upcoming-later",
      title: "Upcoming Later",
      startDateTime: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    });

    const upcomingSooner = makeEvent({
      id: "upcoming-sooner",
      title: "Upcoming Sooner",
      startDateTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    });

    const pastOlder = makeEvent({
      id: "past-older",
      title: "Past Older",
      startDateTime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    });

    const pastRecent = makeEvent({
      id: "past-recent",
      title: "Past Recent",
      startDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      endDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    });

    await eventRepository.addEvent(upcomingLater);
    await eventRepository.addEvent(upcomingSooner);
    await eventRepository.addEvent(pastOlder);
    await eventRepository.addEvent(pastRecent);

    await rsvpRepository.addRSVP(makeRSVP({ eventId: "upcoming-later", userId: "user-1" }));
    await rsvpRepository.addRSVP(makeRSVP({ eventId: "upcoming-sooner", userId: "user-1" }));
    await rsvpRepository.addRSVP(makeRSVP({ eventId: "past-older", userId: "user-1" }));
    await rsvpRepository.addRSVP(makeRSVP({ eventId: "past-recent", userId: "user-1" }));

    const result = await service.getMyRSVPDashboard("user-1", "user");

    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.upcoming.map((entry) => entry.event.title)).toEqual([
      "Upcoming Sooner",
      "Upcoming Later",
    ]);

    expect(result.value.past.map((entry) => entry.event.title)).toEqual([
      "Past Recent",
      "Past Older",
    ]);
  });

  it("denies organizer/admin access to the member RSVP dashboard", async () => {
    const { service } = makeService();

    const staffResult = await service.getMyRSVPDashboard("staff-1", "staff");
    const adminResult = await service.getMyRSVPDashboard("admin-1", "admin");

    expect(staffResult.ok).toBe(false);
    expect(adminResult.ok).toBe(false);

    if (staffResult.ok === false) {
      expect(staffResult.value.message).toBe("Only members can access the RSVP dashboard.");
    }

    if (adminResult.ok === false) {
      expect(adminResult.value.message).toBe("Only members can access the RSVP dashboard.");
    }
  });
});