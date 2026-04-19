// src/repository/InMemoryEventRepository.ts

import { Result, Ok, Err } from "../lib/result";
import type { IEvent, IEventRepository } from "./EventRepository";
import type { ILoggingService } from "../service/LoggingService";
import { EventAlreadyExists, EventNotFound } from "../lib/error";

class InMemoryEventRepository implements IEventRepository {
  private readonly events: Map<string, IEvent> = new Map();
  private nextID: number = 1;

  constructor(private readonly logger: ILoggingService) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    this.events.set("81", {
      id: "81",
      organizerId: "admin-user-id",
      title: "HackHer",
      description: "48 hours to plan, build and showcase!",
      location: "CLS E110",
      category: "educational",
      status: "published",
      startDateTime: tomorrow.toISOString(),
      endDateTime: new Date(tomorrow.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      capacity: 200,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    this.events.set("82", {
      id: "82",
      organizerId: "admin-user-id",
      title: "Open Volleyball",
      description: "Open Gym: volleyball at the rec center",
      location: "Rec Center Courts",
      category: "sports",
      status: "published",
      startDateTime: nextWeek.toISOString(),
      endDateTime: new Date(nextWeek.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 36,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
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