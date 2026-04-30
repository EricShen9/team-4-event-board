import { Result, Ok, Err } from "../lib/result";
import type { ILoggingService } from "./LoggingService";
import type { IRSVP, IEvent, IEventRepository } from "../repository/EventRepository";
import type { IRSVPRepository } from "../repository/RSVPRepository";
import type { UserRole } from "../auth/User";
import {
  RSVPAuthorizationError,
  RSVPStateError,
} from "../lib/error";

export interface IMyRSVPDashboard {
  upcoming: Array<{ event: IEvent; rsvp: IRSVP }>;
  past: Array<{ event: IEvent; rsvp: IRSVP }>;
}

export interface IRSVPDetailState {
  event: IEvent;
  currentRSVP: IRSVP | null;
  attendeeCount: number;
  waitlistPosition: number | null;
  canInteract: boolean;
}

export interface IRSVPService {
  cancelRSVPWithPromotion(
    eventId: string,
    userId: string,
  ): Promise<Result<{ cancelled: IRSVP; promoted?: IRSVP }, Error>>;

  toggleRSVP(
    eventId: string,
    userId: string,
    role: UserRole,
  ): Promise<Result<IRSVP, Error>>;

  getWaitlistPosition(
    eventId: string,
    userId: string,
  ): Promise<Result<number | null, Error>>;

  getRSVPDetailState(
    eventId: string,
    userId: string,
    role: UserRole,
  ): Promise<Result<IRSVPDetailState, Error>>;

  getMyRSVPDashboard(
    userId: string,
    role: UserRole,
  ): Promise<Result<IMyRSVPDashboard, Error>>;
}

class RSVPService implements IRSVPService {
  constructor(
    private readonly rsvpRepository: IRSVPRepository,
    private readonly eventRepository: IEventRepository,
    private readonly logger: ILoggingService,
  ) {}

  async cancelRSVPWithPromotion(
    eventId: string,
    userId: string,
  ): Promise<Result<{ cancelled: IRSVP; promoted?: IRSVP }, Error>> {
    const result = await this.rsvpRepository.cancelRSVPWithPromotion(
      eventId,
      userId,
    );

    if (result.ok === false) {
      return Err(result.value);
    }

    const { cancelled, promoted } = result.value;

    if (promoted) {
      this.logger.info(
        `cancelRSVPWithPromotion: promoted RSVP ${promoted.id} for event ${eventId}.`,
      );
    } else {
      this.logger.info(
        `cancelRSVPWithPromotion: cancelled RSVP ${cancelled.id} with no promotion for event ${eventId}.`,
      );
    }

    return Ok(result.value);
  }

  async getWaitlistPosition(
    eventId: string,
    userId: string,
  ): Promise<Result<number | null, Error>> {
    const eventRSVPsResult = await this.rsvpRepository.getRSVPsByEvent(eventId);

    if (eventRSVPsResult.ok === false) {
      return Err(eventRSVPsResult.value);
    }

    const waitlisted = eventRSVPsResult.value
      .filter((rsvp) => rsvp.status === "waitlisted")
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

    const index = waitlisted.findIndex((rsvp) => rsvp.userId === userId);

    if (index === -1) {
      return Ok(null);
    }

    return Ok(index + 1);
  }

  async getRSVPDetailState(
    eventId: string,
    userId: string,
    role: UserRole,
  ): Promise<Result<IRSVPDetailState, Error>> {
    const eventResult = await this.eventRepository.getEvent(eventId);
    if (eventResult.ok === false) {
      return Err(eventResult.value);
    }

    const event = eventResult.value;

    const currentRSVPResult = await this.rsvpRepository.getRSVPByUserAndEvent(
      userId,
      eventId,
    );
    if (currentRSVPResult.ok === false) {
      return Err(currentRSVPResult.value);
    }

    const allRSVPsResult = await this.rsvpRepository.getRSVPsByEvent(eventId);
    if (allRSVPsResult.ok === false) {
      return Err(allRSVPsResult.value);
    }

    const attendeeCount = allRSVPsResult.value.filter(
      (rsvp) => rsvp.status === "going",
    ).length;

    let waitlistPosition: number | null = null;
    if (currentRSVPResult.value?.status === "waitlisted") {
      const waitlistResult = await this.getWaitlistPosition(eventId, userId);
      if (waitlistResult.ok === false) {
        return Err(waitlistResult.value);
      }
      waitlistPosition = waitlistResult.value;
    }

    const eventEnded = new Date(event.endDateTime) < new Date();
    const canInteract =
      role === "user" &&
      event.status === "published" &&
      !eventEnded;

    return Ok({
      event,
      currentRSVP: currentRSVPResult.value,
      attendeeCount,
      waitlistPosition,
      canInteract,
    });
  }

  async toggleRSVP(
    eventId: string,
    userId: string,
    role: UserRole,
  ): Promise<Result<IRSVP, Error>> {
    if (role !== "user") {
      return Err(RSVPAuthorizationError("Only members can RSVP."));
    }

    const eventResult = await this.eventRepository.getEvent(eventId);
    if (eventResult.ok === false) {
      return Err(eventResult.value);
    }

    const event = eventResult.value;
    const eventEnded = new Date(event.endDateTime) < new Date();

    if (event.status === "cancelled") {
      return Err(RSVPStateError("You cannot RSVP to a cancelled event."));
    }

    if (event.status === "past" || eventEnded) {
      return Err(RSVPStateError("You cannot RSVP to a past event."));
    }

    if (event.status !== "published") {
      return Err(RSVPStateError("You can only RSVP to published events."));
    }

    const existingResult = await this.rsvpRepository.getRSVPByUserAndEvent(
      userId,
      eventId,
    );

    if (existingResult.ok === false) {
      return Err(existingResult.value);
    }

    const existing = existingResult.value;

    const eventRSVPsResult = await this.rsvpRepository.getRSVPsByEvent(eventId);
    if (eventRSVPsResult.ok === false) {
      return Err(eventRSVPsResult.value);
    }

    const goingCount = eventRSVPsResult.value.filter(
      (r) => r.status === "going",
    ).length;

    const isFull =
      typeof event.capacity === "number"
        ? goingCount >= event.capacity
        : false;

    if (!existing) {
      const newRSVP: IRSVP = {
        id: crypto.randomUUID(),
        eventId,
        userId,
        status: isFull ? "waitlisted" : "going",
        createdAt: new Date().toISOString(),
      };

      return this.rsvpRepository.addRSVP(newRSVP);
    }

    if (existing.status === "going" || existing.status === "waitlisted") {
      const result = await this.cancelRSVPWithPromotion(eventId, userId);
      if (result.ok === false) {
        return Err(result.value);
      }
      return Ok(result.value.cancelled);
    }

    return this.rsvpRepository.updateRSVPStatus(
      existing.id,
      isFull ? "waitlisted" : "going",
    );
  }

  async getMyRSVPDashboard(
    userId: string,
    role: UserRole,
  ): Promise<Result<IMyRSVPDashboard, Error>> {
    if (role === "admin" || role === "staff") {
      this.logger.warn(
        `getMyRSVPDashboard: role ${role} is not allowed to access member RSVP dashboard.`,
      );
      return Err(RSVPAuthorizationError("Only members can access the RSVP dashboard."));
    }

    const rsvpsResult = await this.rsvpRepository.getRSVPsByUser(userId);

    if (rsvpsResult.ok === false) {
      return Err(rsvpsResult.value);
    }

    const upcoming: Array<{ event: IEvent; rsvp: IRSVP }> = [];
    const past: Array<{ event: IEvent; rsvp: IRSVP }> = [];

    for (const rsvp of rsvpsResult.value) {
      const eventResult = await this.eventRepository.getEvent(rsvp.eventId);

      if (eventResult.ok === false) {
        continue;
      }

      const event = eventResult.value;
      const eventEnded = new Date(event.endDateTime) < new Date();
      const eventCancelled = event.status === "cancelled";
      const rsvpCancelled = rsvp.status === "cancelled";

      if (eventEnded || eventCancelled || rsvpCancelled) {
        past.push({ event, rsvp });
      } else {
        upcoming.push({ event, rsvp });
      }
    }

    upcoming.sort(
      (a, b) =>
        new Date(a.event.startDateTime).getTime() -
        new Date(b.event.startDateTime).getTime(),
    );

    past.sort(
      (a, b) =>
        new Date(b.event.startDateTime).getTime() -
        new Date(a.event.startDateTime).getTime(),
    );

    return Ok({ upcoming, past });
  }
}

export function CreateRSVPService(
  rsvpRepository: IRSVPRepository,
  eventRepository: IEventRepository,
  logger: ILoggingService,
): IRSVPService {
  return new RSVPService(rsvpRepository, eventRepository, logger);
}