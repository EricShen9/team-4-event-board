import {Result, Ok, Err} from "../lib/result";
import type {IRSVP} from "./EventRepository";
import type {IRSVPRepository} from "./RSVPRepository";
import type {ILoggingService} from "../service/LoggingService";

class InMemoryRSVPRepository implements IRSVPRepository {
  private readonly rsvps: Map<string, IRSVP> = new Map();

  constructor(private readonly logger: ILoggingService) {}

  async addRSVP(rsvp: IRSVP): Promise<Result<IRSVP, Error>> {
    if (this.rsvps.has(rsvp.id)) {
      this.logger.warn(`addRSVP: RSVP with id ${rsvp.id} already exists.`);
      return Err(new Error(`RSVP with id ${rsvp.id} already exists.`));
    }

    this.rsvps.set(rsvp.id, rsvp);
    this.logger.info(`addRSVP: stored RSVP ${rsvp.id}.`);
    return Ok(rsvp);
  }

  async getRSVPByUserAndEvent(
    userId: string,
    eventId: string,
  ): Promise<Result<IRSVP | null, Error>> {
    for (const rsvp of this.rsvps.values()) {
      if (rsvp.userId === userId && rsvp.eventId === eventId) {
        this.logger.info(`getRSVPByUserAndEvent: found RSVP for user ${userId} on event ${eventId}.`);
        return Ok(rsvp);
      }
    }

    this.logger.info(`getRSVPByUserAndEvent: no RSVP found for user ${userId} on event ${eventId}.`);
    return Ok(null);
  }

  async updateRSVPStatus(
    rsvpId: string,
    status: IRSVP["status"],
  ): Promise<Result<IRSVP, Error>> {
    const existing = this.rsvps.get(rsvpId);

    if (!existing) {
      this.logger.warn(`updateRSVPStatus: RSVP with id ${rsvpId} not found.`);
      return Err(new Error(`RSVP with id ${rsvpId} not found.`));
    }

    const updated: IRSVP = {
      ...existing,
      status,
    };

    this.rsvps.set(rsvpId, updated);
    this.logger.info(`updateRSVPStatus: updated RSVP ${rsvpId} to status ${status}.`);
    return Ok(updated);
  }

  async getRSVPsByEvent(eventId: string): Promise<Result<IRSVP[], Error>> {
    const rsvps = Array.from(this.rsvps.values()).filter(
      (rsvp) => rsvp.eventId === eventId,
    );

    this.logger.info(`getRSVPsByEvent: found ${rsvps.length} RSVPs for event ${eventId}.`);
    return Ok(rsvps);
  }

  async getRSVPsByUser(userId: string): Promise<Result<IRSVP[], Error>> {
    const rsvps = Array.from(this.rsvps.values()).filter(
      (rsvp) => rsvp.userId === userId,
    );

    this.logger.info(`getRSVPsByUser: found ${rsvps.length} RSVPs for user ${userId}.`);
    return Ok(rsvps);
  }
}

export function CreateInMemoryRSVPRepository(
  logger: ILoggingService,
): IRSVPRepository {
  return new InMemoryRSVPRepository(logger);
}