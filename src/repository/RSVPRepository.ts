import {Result} from "../lib/result";
import type {IRSVP} from "./EventRepository";

export interface IRSVPRepository {
  addRSVP(rsvp: IRSVP): Promise<Result<IRSVP, Error>>;
  getRSVPByUserAndEvent(userId: string, eventId: string): Promise<Result<IRSVP | null, Error>>;
  updateRSVPStatus(rsvpId: string, status: IRSVP["status"]): Promise<Result<IRSVP, Error>>;
  getRSVPsByEvent(eventId: string): Promise<Result<IRSVP[], Error>>;
  getRSVPsByUser(userId: string): Promise<Result<IRSVP[], Error>>;
}