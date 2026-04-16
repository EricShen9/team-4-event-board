import { Result, Ok, Err } from "../lib/result";
import type { ILoggingService } from "./LoggingService";
import type { IRSVP, IEvent, IEventRepository } from "../repository/EventRepository";
import type { IRSVPRepository } from "../repository/RSVPRepository";
import type { UserRole } from "../auth/User";

type RSVPStatus = "going" | "waitlisted" | "cancelled";

export interface IMyRSVPDashboard {
  upcoming: Array<{ event: IEvent; rsvp: IRSVP }>;
  past: Array<{ event: IEvent; rsvp: IRSVP }>;
}

export interface IRSVPService {
  cancelRSVPWithPromotion(
    eventId: string,
    userId: string,
  ): Promise<Result<{ cancelled: IRSVP; promoted?: IRSVP }, Error>>;

  getWaitlistPosition(
    eventId: string,
    userId: string,
  ): Promise<Result<number | null, Error>>;

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
    const existingResult = await this.rsvpRepository.getRSVPByUserAndEvent(
      userId,
      eventId,
    );

    if (existingResult.ok === false) {
      return Err(existingResult.value);
    }

    const existing = existingResult.value;
    if (!existing) {
      this.logger.warn(
        `cancelRSVPWithPromotion: RSVP not found for user ${userId} on event ${eventId}.`,
      );
      return Err(new Error("RSVP not found."));
    }

    if (existing.status === "cancelled") {
      this.logger.warn(
        `cancelRSVPWithPromotion: RSVP already cancelled for user ${userId} on event ${eventId}.`,
      );
      return Err(new Error("RSVP is already cancelled."));
    }

    const cancelledResult = await this.rsvpRepository.updateRSVPStatus(
      existing.id,
      "cancelled" as RSVPStatus as IRSVP["status"],
    );

    if (cancelledResult.ok === false) {
      return Err(cancelledResult.value);
    }

    const cancelled = cancelledResult.value;

    if (existing.status !== ("going" as RSVPStatus as IRSVP["status"])) {
      return Ok({ cancelled });
    }

    const eventRSVPsResult = await this.rsvpRepository.getRSVPsByEvent(eventId);

    if (eventRSVPsResult.ok === false) {
      return Err(eventRSVPsResult.value);
    }

    const nextWaitlisted = eventRSVPsResult.value
      .filter(
        (rsvp) =>
          rsvp.status === ("waitlisted" as RSVPStatus as IRSVP["status"]),
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];

    if (!nextWaitlisted) {
      this.logger.info(
        `cancelRSVPWithPromotion: no waitlisted RSVP to promote for event ${eventId}.`,
      );
      return Ok({ cancelled });
    }

    const promotedResult = await this.rsvpRepository.updateRSVPStatus(
      nextWaitlisted.id,
      "going" as RSVPStatus as IRSVP["status"],
    );

    if (promotedResult.ok === false) {
      return Err(promotedResult.value);
    }

    this.logger.info(
      `cancelRSVPWithPromotion: promoted RSVP ${nextWaitlisted.id} for event ${eventId}.`,
    );

    return Ok({
      cancelled,
      promoted: promotedResult.value,
    });
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
      .filter(
        (rsvp) =>
          rsvp.status === ("waitlisted" as RSVPStatus as IRSVP["status"]),
      )
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

  async getMyRSVPDashboard(
    userId: string,
    role: UserRole,
  ): Promise<Result<IMyRSVPDashboard, Error>> {
    if (role === "admin" || role === "staff") {
      this.logger.warn(
        `getMyRSVPDashboard: role ${role} is not allowed to access member RSVP dashboard.`,
      );
      return Err(new Error("Only members can access the RSVP dashboard."));
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

      if (eventEnded || eventCancelled) {
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