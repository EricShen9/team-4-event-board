// src/service/EventService.ts

import { Result, Ok, Err } from "../lib/result";
import type { ILoggingService } from "./LoggingService";
import type { statusType, IEvent, IRSVP, IEventRepository } from "../repository/EventRepository";
import type { UserRole } from "../auth/User";
import { EventValidationError } from "../lib/error";
/**
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
    if (eventForm.startDateTime! < new Date().toISOString()) {
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
    // Fetch existing event
    const existingResult = await this.repository.getEvent(eventId);
    if (!existingResult.ok) {
      this.logger.warn(`modifyEvent: event ${eventId} not found.`);
      return existingResult;
    }

    const existing = existingResult.value;
    const now = new Date();

    // Service responsibility: Validate state-based rules first
    if (existing.status === "cancelled") {
      this.logger.warn("modifyEvent: cannot modify cancelled event.");
      return Err(new Error("Cannot modify a cancelled event."));
    }
    
    if (new Date(existing.startDateTime) < now) {
      this.logger.warn("modifyEvent: cannot modify past event.");
      return Err(new Error("Cannot modify a past event."));
    }

    // Service responsibility: Date format validation (if provided)
    if (patch.startDateTime) {
      const newStart = new Date(patch.startDateTime);
      if (Number.isNaN(newStart.getTime())) {
        this.logger.warn("modifyEvent: invalid start date/time format.");
        return Err(new Error("Invalid start date/time format."));
      }
    }

    if (patch.endDateTime) {
      const newEnd = new Date(patch.endDateTime);
      if (Number.isNaN(newEnd.getTime())) {
        this.logger.warn("modifyEvent: invalid end date/time format.");
        return Err(new Error("Invalid end date/time format."));
      }
    }

    // Service responsibility: Chronology validation
    const effectiveStart = patch.startDateTime
      ? new Date(patch.startDateTime)
      : new Date(existing.startDateTime);
    const effectiveEnd = patch.endDateTime
      ? new Date(patch.endDateTime)
      : new Date(existing.endDateTime);

    if (effectiveStart >= effectiveEnd) {
      this.logger.warn("modifyEvent: start must be before end.");
      return Err(new Error("Event start must be before end time."));
    }

    // Service responsibility: Past date validation (if changed)
    if (patch.startDateTime && effectiveStart < now) {
      this.logger.warn("modifyEvent: start date cannot be in the past.");
      return Err(new Error("Start date/time cannot be in the past."));
    }

    // Service responsibility: Capacity validation (if provided)
    if (patch.capacity !== undefined) {
      if (
        typeof patch.capacity !== "number" ||
        !Number.isFinite(patch.capacity) ||
        patch.capacity <= 0
      ) {
        this.logger.warn("modifyEvent: invalid capacity.");
        return Err(new Error("Capacity must be a positive non-zero number."));
      }
    }

    // Service responsibility: Status validation (if provided)
    if (patch.status !== undefined) {
      const validStatuses: statusType[] = ["draft", "published", "cancelled", "past"];
      if (!validStatuses.includes(patch.status)) {
        this.logger.warn(`modifyEvent: invalid status ${patch.status}.`);
        return Err(new Error("Invalid status."));
      }
    }

    // Build updated event
    const updatedEvent: IEvent = {
      ...existing,
      ...patch,
      id: eventId, // Ensure ID doesn't change
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };

    // Auto-set status to "past" if start date has passed
    if (new Date(updatedEvent.startDateTime) < new Date()) {
      updatedEvent.status = "past";
    }

    return this.repository.editEvent(eventId, updatedEvent);
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
      const err = new Error("Search query is too long.");
      (err as Error & { name: string }).name = "ValidationError";
      return Err(err);
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
      return Err(new Error("Event ID is required."));
    }
    const result = await this.repository.getEvent(eventId);
    if (!result.ok) {
      return result;
    }
    const event = result.value;

    if (event.status === "draft") {
      if (event.organizerId !== actingUserId && actingUserRole !== "admin") {
        return Err(new Error("Event not found."));
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
      return Err(new Error(`Invalid category: ${filters.category}`));
    }
    if (filters.timeframe && !validTimeframes.includes(filters.timeframe)) {
      return Err(new Error(`Invalid timeframe: ${filters.timeframe}`));
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