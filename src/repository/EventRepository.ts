import { Result } from "../lib/result";

export type statusType = "published" | "draft" | "cancelled" | "past";

export interface IEvent {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  location: string;
  category: string;
  status: statusType;
  startDateTime: string; // ISO
  endDateTime: string; // ISO
  capacity?: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  users?: Array<Set<string>>; // original shape had `user: Set[]` — using a permissive replacement
}

export interface IRSVP {
  id: string;
  eventId: string;
  userId: string;
  status: statusType;
  createdAt: string;
}


export interface IEventRepository {
  addEvent(event: IEvent): Promise<Result<IEvent, Error>>;
  editEvent(eventId: string, event: IEvent): Promise<Result<IEvent, Error>>;
  getEvent(eventId: string): Promise<Result<IEvent, Error>>;
  searchEvents(term: string): Promise<Result<IEvent[], Error>>;
}
