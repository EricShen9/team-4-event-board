// src/service/EventService.ts

import { Result, Ok, Err } from "../lib/result";
import type { ILoggingService } from "./LoggingService";
import type { statusType, IEvent, IRSVP, IEventRepository } from "../repository/EventRepository";

/**
 * Service interface — imported by EventController.
 */
export interface IEventService {
  createEvent(eventForm: Partial<IEvent>): Promise<Result<IEvent, Error>>;
  modifyEvent(eventId: string, patch: Partial<IEvent>): Promise<Result<IEvent, Error>>;
  getEvent(eventId: string): Promise<Result<IEvent, Error>>;
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
    // Required fields
    if (!eventForm.title || eventForm.title.trim() === "") {
      this.logger.warn("Create event: title is required.");
      return Err(new Error("Title is required."));
    }
    if (!eventForm.startDateTime) {
      this.logger.warn("Create event: start date/time is required.");
      return Err(new Error("Start date/time is required."));
    }
    if (!eventForm.endDateTime) {
      this.logger.warn("Create event: end date/time is required.");
      return Err(new Error("End date/time is required."));
    }

    // Date validation
    const now = new Date();
    const start = new Date(eventForm.startDateTime);
    const end = new Date(eventForm.endDateTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      this.logger.warn("Create event: invalid date/time format.");
      return Err(new Error("Invalid date/time format."));
    }
    if (start < now) {
      this.logger.warn("Create event: start is before current time.");
      return Err(new Error("Event start cannot be before current time."));
    }
    if (start >= end) {
      this.logger.warn("Create event: start is not before end.");
      return Err(new Error("Event start must be before end time."));
    }

    // Capacity
    if (eventForm.capacity !== undefined) {
      if (
        typeof eventForm.capacity !== "number" ||
        !Number.isFinite(eventForm.capacity) ||
        eventForm.capacity <= 0
      ) {
        this.logger.warn("Create event: invalid capacity.");
        return Err(new Error("Capacity must be a positive non-zero number."));
      }
    }

    // Build full event
    const nowISO = now.toISOString();
    const event: IEvent = {
      id: this.generateId(),
      organizerId: eventForm.organizerId ?? "",
      title: eventForm.title.trim(),
      description: eventForm.description?.trim() ?? "",
      location: eventForm.location?.trim() ?? "",
      category: eventForm.category?.trim() ?? "",
      status: "draft",
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      capacity: eventForm.capacity,
      createdAt: eventForm.createdAt ?? nowISO,
      updatedAt: eventForm.updatedAt ?? nowISO,
    };

    return this.repository.addEvent(event);
  }

  // ── Stubs — to be implemented later ────────────────────────────────

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

    // Validate date changes if provided
    const now = new Date();
    const effectiveStart = patch.startDateTime 
      ? new Date(patch.startDateTime) 
      : new Date(existing.startDateTime);
    const effectiveEnd = patch.endDateTime 
      ? new Date(patch.endDateTime) 
      : new Date(existing.endDateTime);

    // Start date validation (if changed)
    if (patch.startDateTime) {
      const newStart = new Date(patch.startDateTime);
      if (Number.isNaN(newStart.getTime())) {
        this.logger.warn("modifyEvent: invalid start date/time format.");
        return Err(new Error("Invalid start date/time format."));
      }
      if (newStart < now) {
        this.logger.warn("modifyEvent: start date cannot be in the past.");
        return Err(new Error("Start date/time cannot be in the past."));
      }
    }

    // End date validation (if changed)
    if (patch.endDateTime) {
      const newEnd = new Date(patch.endDateTime);
      if (Number.isNaN(newEnd.getTime())) {
        this.logger.warn("modifyEvent: invalid end date/time format.");
        return Err(new Error("Invalid end date/time format."));
      }
    }

    // Chronology validation
    if (effectiveStart >= effectiveEnd) {
      this.logger.warn("modifyEvent: start must be before end.");
      return Err(new Error("Event start must be before end time."));
    }

    // Capacity validation (if changed)
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

    // Status transition validation
    if (patch.status !== undefined) {
      const validStatuses: statusType[] = ["draft", "published", "cancelled", "past"];
      if (!validStatuses.includes(patch.status)) {
        this.logger.warn(`modifyEvent: invalid status ${patch.status}.`);
        return Err(new Error("Invalid status."));
      }

      // Prevent modification of cancelled events
      if (existing.status === "cancelled") {
        this.logger.warn("modifyEvent: cannot modify cancelled event.");
        return Err(new Error("Cannot modify a cancelled event."));
      }

      // Prevent modification of past events
      if (existing.status === "past" || new Date(existing.startDateTime) < now) {
        this.logger.warn("modifyEvent: cannot modify past event.");
        return Err(new Error("Cannot modify a past event."));
      }
    }

    // Build updated event
    const updatedEvent: IEvent = {
      ...existing,
      ...patch,
      id: eventId, // Ensure ID doesn't change
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };

    // If startDateTime passed and event is past, auto-set status
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
}

export function CreateEventService(
  repository: IEventRepository,
  logger: ILoggingService,
): IEventService {
  return new EventService(repository, logger);
}