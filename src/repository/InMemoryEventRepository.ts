// src/repository/InMemoryEventRepository.ts

import { Result, Ok, Err } from "../lib/result";
import type { IEvent, IEventRepository } from "./EventRepository";
import type { ILoggingService } from "../service/LoggingService";

class InMemoryEventRepository implements IEventRepository {
  private readonly events: Map<string, IEvent> = new Map();

  constructor(private readonly logger: ILoggingService) {}

  async addEvent(event: IEvent): Promise<Result<IEvent, Error>> {
    if (this.events.has(event.id)) {
      this.logger.warn(`addEvent: event with id ${event.id} already exists.`);
      return Err(new Error(`Event with id ${event.id} already exists.`));
    }

    this.events.set(event.id, event);
    this.logger.info(`addEvent: stored event ${event.id} ("${event.title}").`);
    return Ok(event);
  }

  // ── Stubs — to be implemented later ────────────────────────────────

  async editEvent(
    eventId: string,
    event: IEvent,
  ): Promise<Result<IEvent, Error>> {
    if (!this.events.has(eventId)) {
      this.logger.warn(`editEvent: event with id ${eventId} not found.`);
      return Err(new Error(`Event with id ${eventId} not found.`));
    }

    // Ensure the event being saved has the correct ID
    if (event.id !== eventId) {
      this.logger.warn(`editEvent: event id mismatch (${event.id} vs ${eventId}).`);
      return Err(new Error("Event ID mismatch."));
    }

    this.events.set(eventId, event);
    this.logger.info(`editEvent: updated event ${eventId} ("${event.title}").`);
    return Ok(event);
  }

  async getEvent(eventId: string): Promise<Result<IEvent, Error>> {
    const event = this.events.get(eventId);
    
    if (!event) {
      this.logger.warn(`getEvent: event with id ${eventId} not found.`);
      return Err(new Error(`Event with id ${eventId} not found.`));
    }

    this.logger.info(`getEvent: retrieved event ${eventId}.`);
    return Ok(event);
  }

  async getAllEvents(): Promise<IEvent[]> {
    return Array.from(this.events.values());
  }
}

export function CreateInMemoryEventRepository(
  logger: ILoggingService,
): IEventRepository {
  return new InMemoryEventRepository(logger);
}