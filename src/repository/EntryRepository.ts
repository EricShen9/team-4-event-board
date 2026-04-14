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
}