// src/service/EventService.ts

import { Result, Ok, Err } from "../lib/result";
import type { ILoggingService } from "./LoggingService";
import type { statusType, IEvent, IRSVP, IEventRepository } from "../repository/EventRepository";
import type { UserRole } from "../auth/User";
import {
  EventValidationError,
  EventNotFound,
  SearchValidationError,
} from "../lib/error";/**
 * Service interface — imported by EventController.
 */
export interface IEventService {
  createEvent(eventForm: Partial<IEvent>): Promise<Result<IEvent, Error>>;
  modifyEvent(eventId: string, patch: Partial<IEvent>): Promise<Result<IEvent, Error>>;
  getEvent(eventId: string): Promise<Result<IEvent, Error>>;
  searchEvents(term: string): Promise<Result<IEvent[], Error>>;
  publishEvent(eventId: string, userId: string, userRole: UserRole): Promise<Result<IEvent, Error>>;
  cancelEvent(eventId: string, userId: string, userRole: UserRole): Promise<Result<IEvent, Error>>;
  getOrganizerEvents(organizerId: string): Promise<Result<IEvent[], Error>>;
  getEventsAdmin(): Promise<Result<IEvent[], Error>>;
  getEventById(eventId: string, actingUserId: string, actingUserRole: UserRole): Promise<Result<IEvent, Error>>;
  filterEvents(filters: { category?: string; timeframe?: string }): Promise<Result<IEvent[], Error>>;
}

// Helper functions for date range calculations
function getWeekRange(now: Date): { start: Date; end: Date } {
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function getWeekendRange(now: Date): { start: Date; end: Date } {
  const dayOfWeek = now.getDay();
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + (6 - dayOfWeek));
  saturday.setHours(0, 0, 0, 0);
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);
  sunday.setHours(23, 59, 59, 999);
  return { start: saturday, end: sunday };
}

class EventService implements IEventService {
  constructor(
    private readonly repository: IEventRepository,
    private readonly logger: ILoggingService,
  ) {}
  private nextId: number = 1;
  private generateId(): string {
    return `${this.nextId++}`;
  }

  async createEvent(eventForm: Partial<IEvent>): Promise<Result<IEvent, Error>> {
    if (eventForm.startDateTime! >= eventForm.endDateTime!) {
      this.logger.warn("Create event: start is not before end.");
      return Err(EventValidationError("Event start must be before end time."));
    }
    if (eventForm.startDateTime! < eventForm.createdAt!) {
      this.logger.warn("Create event: start is before current time.");
      return Err(EventValidationError("Event start cannot be before current time."));
    }
    if (eventForm.capacity !== undefined) {
      if (
        typeof eventForm.capacity !== "number" ||
        !Number.isFinite(eventForm.capacity) ||
        eventForm.capacity <= 0
      ) {
        this.logger.warn("Create event: invalid capacity.");
        return Err(EventValidationError("Capacity must be a positive non-zero number."));
      }
    }

    return this.repository.addEvent(eventForm as IEvent);
  }

  async modifyEvent(
    eventId: string,
    patch: Partial<IEvent>,
  ): Promise<Result<IEvent, Error>> {
    // Fetch existing event first to check business rules
    const existingResult = await this.repository.getEvent(eventId);
    if (!existingResult.ok) {
      return existingResult;
    }
    
    const existingEvent = existingResult.value;
    const now = new Date();
    
    // Business logic: State-based rules
    if (existingEvent.status === "cancelled") {
      this.logger.warn(`modifyEvent: cannot modify cancelled event ${eventId}.`);
      return Err(EventValidationError("Cannot modify a cancelled event."));
    }
    if (new Date(existingEvent.startDateTime) < now) {
      this.logger.warn(`modifyEvent: cannot modify past event ${eventId}.`);
      return Err(EventValidationError("Cannot modify a past event."));
    }
    
    // Business logic: Chronology validation
    if (patch.startDateTime! >= patch.endDateTime!) {
      this.logger.warn("Create event: start is not before end.");
      return Err(EventValidationError("Event start must be before end time."));
    }
    if (patch.startDateTime! < patch.updatedAt!) {
      this.logger.warn("Create event: start is before current time.");
      return Err(EventValidationError("Event start cannot be before current time."));
    }

    if (patch.capacity !== undefined) {
      if (
        typeof patch.capacity !== "number" ||
        !Number.isFinite(patch.capacity) ||
        patch.capacity <= 0
      ) {
        this.logger.warn("Create event: invalid capacity.");
        return Err(EventValidationError("Capacity must be a positive non-zero number."));
      }
    }
    
    return this.repository.editEvent(eventId, patch as IEvent);
  }

  async getEvent(eventId: string): Promise<Result<IEvent, Error>> {
    if (!eventId || eventId.trim() === "") {
      this.logger.warn("getEvent: eventId is required.");
      return Err(new Error("Event ID is required."));
    }

    return this.repository.getEvent(eventId);
  }
  async searchEvents(term: string): Promise<Result<IEvent[], Error>> {
  const normalizedTerm = term.trim();

  if (normalizedTerm.length > 200) {
    this.logger.warn("searchEvents: search query is too long.");
    return Err(
      SearchValidationError("Search query must be 200 characters or fewer."),
    );
  }

  return this.repository.searchEvents(normalizedTerm);
}

  // ── Lifecycle transitions (Feature 5, Sprint 1) ───────────────────

  async publishEvent(
    eventId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<Result<IEvent, Error>> {
    if (!eventId || eventId.trim() === "") {
      this.logger.warn("publishEvent: eventId is required.");
      return Err(new Error("Event ID is required."));
    }

    // Fetch existing event
    const existingResult = await this.repository.getEvent(eventId);
    if (!existingResult.ok) {
      this.logger.warn(`publishEvent: event ${eventId} not found.`);
      return existingResult;
    }

    const existing = existingResult.value;

    // Ownership check: only the organizer can publish their own event
    if (existing.organizerId !== userId) {
      this.logger.warn(
        `publishEvent: user ${userId} is not the organizer of event ${eventId}.`,
      );
      const err = new Error("Only the event organizer can publish this event.");
      (err as any).name = "AuthorizationRequired";
      return Err(err);
    }

    // State check: only draft events can be published
    if (existing.status !== "draft") {
      this.logger.warn(
        `publishEvent: event ${eventId} has status "${existing.status}", expected "draft".`,
      );
      const err = new Error(
        `Cannot publish an event with status "${existing.status}". Only draft events can be published.`,
      );
      (err as any).name = "InvalidStateTransition";
      return Err(err);
    }

    // Apply transition
    const updatedEvent: IEvent = {
      ...existing,
      status: "published",
      updatedAt: new Date().toISOString(),
    };

    return this.repository.editEvent(eventId, updatedEvent);
  }

  async cancelEvent(
    eventId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<Result<IEvent, Error>> {
    if (!eventId || eventId.trim() === "") {
      this.logger.warn("cancelEvent: eventId is required.");
      return Err(new Error("Event ID is required."));
    }

    // Fetch existing event
    const existingResult = await this.repository.getEvent(eventId);
    if (!existingResult.ok) {
      this.logger.warn(`cancelEvent: event ${eventId} not found.`);
      return existingResult;
    }

    const existing = existingResult.value;

    // Ownership check: organizer OR admin can cancel
    const isOrganizer = existing.organizerId === userId;
    const isAdmin = userRole === "admin";

    if (!isOrganizer && !isAdmin) {
      this.logger.warn(
        `cancelEvent: user ${userId} (role: ${userRole}) is not authorized to cancel event ${eventId}.`,
      );
      const err = new Error(
        "Only the event organizer or an admin can cancel this event.",
      );
      (err as any).name = "AuthorizationRequired";
      return Err(err);
    }

    // State check: only published events can be cancelled
    if (existing.status !== "published") {
      this.logger.warn(
        `cancelEvent: event ${eventId} has status "${existing.status}", expected "published".`,
      );
      const err = new Error(
        `Cannot cancel an event with status "${existing.status}". Only published events can be cancelled.`,
      );
      (err as any).name = "InvalidStateTransition";
      return Err(err);
    }

    // Apply transition
    const updatedEvent: IEvent = {
      ...existing,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };

    return this.repository.editEvent(eventId, updatedEvent);
  }

  async getEventById(eventId: string, actingUserId: string, actingUserRole: UserRole): Promise<Result<IEvent, Error>> {
    if (!eventId || eventId.trim() === "") {
      return Err(EventValidationError("Event ID is required."));
    }
    const result = await this.repository.getEvent(eventId);
    if (!result.ok) {
      return Err(EventNotFound(`Event ${eventId} not found.`));
    }
    const event = result.value;

    if (event.status === "draft") {
      if (event.organizerId !== actingUserId && actingUserRole !== "admin") {
        return Err(EventNotFound("Event not found."));
      }
    }

    return Ok(event);
  }

  async filterEvents(filters: {
    category?: string;
    timeframe?: string;
  }): Promise<Result<IEvent[], Error>> {
    const validCategories = ["social", "educational", "volunteer", "sports", "arts"];
    const validTimeframes = ["upcoming", "this_week", "this_weekend"];

    if (filters.category && !validCategories.includes(filters.category)) {
      return Err(EventValidationError(`Invalid category: ${filters.category}`));
    }
    if (filters.timeframe && !validTimeframes.includes(filters.timeframe)) {
      return Err(EventValidationError(`Invalid timeframe: ${filters.timeframe}`));
    }

    const allResult = await this.repository.getAllEvents();
    if (!allResult.ok) {
      return allResult;
    }
    const allEvents = allResult.value;
    const now = new Date();

    const filtered = allEvents.filter((event) => {
      if (event.status !== "published") return false;
      if (filters.category && event.category !== filters.category) return false;

      const start = new Date(event.startDateTime);

      if (filters.timeframe === "upcoming") {
        if (start <= now) return false;
      } else if (filters.timeframe === "this_week") {
        const week = getWeekRange(now);
        if (start < week.start || start > week.end) return false;
      } else if (filters.timeframe === "this_weekend") {
        const weekend = getWeekendRange(now);
        if (start < weekend.start || start > weekend.end) return false;
      } else {
        if (start <= now) return false;
      }

      return true;
    });

    return Ok(filtered);
  }

  async getOrganizerEvents(organizerId: string): Promise<Result<IEvent[], Error>> {
    if (!organizerId || organizerId.trim() === "") {
      this.logger.warn("getOrganizerEvents: organizerId is required.");
      return Err(new Error("Organizer ID is required."));
    }

    const allResult = await this.repository.getAllEvents();
    if (!allResult.ok) {
      return allResult;
    }

    const filtered = allResult.value.filter(
      (event) => event.organizerId === organizerId,
    );

    this.logger.info(
      `getOrganizerEvents: found ${filtered.length} event(s) for organizer ${organizerId}.`,
    );
    return Ok(filtered);
  }

  async getEventsAdmin(): Promise<Result<IEvent[], Error>> {
    const allResult = await this.repository.getAllEvents();
    if (!allResult.ok) {
      return allResult;
    }

    this.logger.info(
      `getEventsAdmin: returning ${allResult.value.length} event(s).`,
    );
    return Ok(allResult.value);
  }
}

export function CreateEventService(
  repository: IEventRepository,
  logger: ILoggingService,
): IEventService {
  return new EventService(repository, logger);
}