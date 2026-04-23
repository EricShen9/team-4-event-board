// src/repository/InMemoryEventRepository.ts

import { Result, Ok, Err } from "../lib/result";
import type { IEvent, IEventRepository } from "./EventRepository";
import type { ILoggingService } from "../service/LoggingService";
import { EventAlreadyExists, EventNotFound, EventIdMismatch } from "../lib/error";

class InMemoryEventRepository implements IEventRepository {
  private readonly events: Map<string, IEvent> = new Map();
  private nextID: number = 1;

  constructor(private readonly logger: ILoggingService) {
  }

  private generateId(): string {
    return `${this.nextID++}`;
  }

  async addEvent(event: IEvent): Promise<Result<IEvent, Error>> {
    const eventWithId = {
      ...event,
      id: event.id || this.generateId(),
    };

    if (this.events.has(eventWithId.id)) {
      this.logger.warn(`addEvent: event with id ${eventWithId.id} already exists.`);
      return Err(EventAlreadyExists(`Event with id ${eventWithId.id} already exists.`));
    }

    this.events.set(eventWithId.id, eventWithId);
    this.logger.info(`addEvent: stored event ${eventWithId.id} ("${eventWithId.title}").`);
    return Ok(eventWithId);
  }

  async editEvent(
    eventId: string,
    patch: Partial<IEvent>,
  ): Promise<Result<IEvent, Error>> {
    // Check if event exists
    if (!this.events.has(eventId)) {
      this.logger.warn(`modifyEvent: event with id ${eventId} not found.`);
      return Err(EventNotFound(`Event with id ${eventId} not found.`));
    }

    const existingEvent = this.events.get(eventId)!;
    
    // Check for event ID mismatch
    if (patch.id && patch.id !== eventId) {
      this.logger.warn(`modifyEvent: event id mismatch (${patch.id} vs ${eventId}).`);
      return Err(EventIdMismatch("Event ID mismatch."));
    }

    // Simple merge and save - NO business logic
    const updatedEvent: IEvent = {
      ...existingEvent,
      ...patch,
      id: eventId,
    };

    this.events.set(eventId, updatedEvent);
    this.logger.info(`modifyEvent: updated event ${eventId} ("${updatedEvent.title}").`);
    return Ok(updatedEvent);
  }

  async getEvent(eventId: string): Promise<Result<IEvent, Error>> {
    const event = this.events.get(eventId);
    
    if (!event) {
      this.logger.warn(`getEvent: event with id ${eventId} not found.`);
      return Err(EventNotFound(`Event with id ${eventId} not found.`));
    }

    this.logger.info(`getEvent: retrieved event ${eventId}.`);
    return Ok(event);
  }

async searchEvents(term: string): Promise<Result<IEvent[], Error>> {
    try {
      const normalizedTerm = term.trim().toLowerCase();
      const now = new Date();

      const matches = Array.from(this.events.values())
        .filter((event) => {
          if (event.status !== "published") {
            return false;
          }

          const start = new Date(event.startDateTime);
          if (Number.isNaN(start.getTime()) || start <= now) {
            return false;
          }

          if (!normalizedTerm) {
            return true;
          }

          return (
            event.title.toLowerCase().includes(normalizedTerm) ||
            event.description.toLowerCase().includes(normalizedTerm) ||
            event.location.toLowerCase().includes(normalizedTerm)
          );
        })
        .sort(
          (a, b) =>
            new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime(),
        );

      this.logger.info(
        `searchEvents: found ${matches.length} matching published upcoming event(s).`,
      );
      return Ok(matches);
    } catch {
      this.logger.error("searchEvents: unable to search events.");
      return Err(new Error("Unable to search events."));
    }
  }

  async getAllEvents(): Promise<Result<IEvent[], Error>> {
    const result = Array.from(this.events.values());
    this.logger.info(`getAllEvents: returning ${result.length} event(s).`);
    return Ok(result);
  
  }
}

export function CreateInMemoryEventRepository(
  logger: ILoggingService,
): IEventRepository {
  return new InMemoryEventRepository(logger);
}