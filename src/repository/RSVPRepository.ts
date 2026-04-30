import {Result} from "../lib/result";
import type {IEvent, IRSVP} from "./EventRepository";

export interface IRSVPRepository {
  addRSVP(rsvp: IRSVP): Promise<Result<IRSVP, Error>>;
  getRSVPByUserAndEvent(userId: string, eventId: string): Promise<Result<IRSVP | null, Error>>;
  updateRSVPStatus(rsvpId: string, status: IRSVP["status"]): Promise<Result<IRSVP, Error>>;
  getRSVPsByEvent(eventId: string): Promise<Result<IRSVP[], Error>>;
  getRSVPsByUser(userId: string): Promise<Result<IRSVP[], Error>>;

  getRSVPsWithEventsByUser?(
    userId: string,
  ): Promise<Result<Array<{ event: IEvent; rsvp: IRSVP }>, Error>>;

  cancelRSVPWithPromotion(
    eventId: string,
    userId: string,
  ): Promise<Result<{ cancelled: IRSVP; promoted?: IRSVP }, Error>>;
}