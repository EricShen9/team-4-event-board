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
    _eventId: string,
    _event: IEvent,
  ): Promise<Result<IEvent, Error>> {
    this.logger.warn("editEvent is not yet implemented.");
    return Err(new Error("Not implemented."));
  }

  async getEvent(_eventId: string): Promise<Result<IEvent, Error>> {
    this.logger.warn("getEvent is not yet implemented.");
    return Err(new Error("Not implemented."));
  }
}

export function CreateInMemoryEventRepository(
  logger: ILoggingService,
): IEventRepository {
  return new InMemoryEventRepository(logger);
}