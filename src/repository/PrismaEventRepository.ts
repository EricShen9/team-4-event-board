import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Result, Ok, Err } from "../lib/result";
import type { IEvent, IEventRepository } from "./EventRepository";
import type { ILoggingService } from "../service/LoggingService";
import { EventAlreadyExists, EventNotFound, EventIdMismatch } from "../lib/error";
import { statusType } from "./EventRepository";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

class PrismaEventRepository implements IEventRepository {
  private prisma: PrismaClient;

  constructor(
    private readonly logger: ILoggingService,
    prismaClient?: PrismaClient,
  ) {
    this.prisma = prismaClient || prisma;
  }

  async addEvent(event: IEvent): Promise<Result<IEvent, Error>> {
    try {
      const { id, ...eventData } = event;

      const createdEvent = await this.prisma.event.create({
        data: {
          organizerId: eventData.organizerId,
          title: eventData.title,
          description: eventData.description,
          location: eventData.location,
          category: eventData.category,
          status: eventData.status,
          startDateTime: eventData.startDateTime,
          endDateTime: eventData.endDateTime,
          capacity: eventData.capacity,
          createdAt: eventData.createdAt,
          updatedAt: eventData.updatedAt,
        },
      });

      const resultEvent: IEvent = {
        ...createdEvent,
        id: createdEvent.id.toString(),
        status: createdEvent.status as statusType,
        capacity: createdEvent.capacity ?? undefined,
        updatedAt: createdEvent.updatedAt ?? undefined,
      };

      this.logger.info(
        `addEvent: stored event ${resultEvent.id} ("${resultEvent.title}").`,
      );
      return Ok(resultEvent);
    } catch (error) {
      if ((error as any).code === "P2002") {
        this.logger.warn(`addEvent: event with id already exists.`);
        return Err(EventAlreadyExists(`Event already exists.`));
      }
      this.logger.error(`addEvent failed: ${error}`);
      return Err(new Error(`Failed to create event: ${error}`));
    }
  }

  async editEvent(
    eventId: string,
    patch: Partial<IEvent>,
  ): Promise<Result<IEvent, Error>> {
    try {
      const numericId = parseInt(eventId, 10);
      
      // Check if event exists
      const existing = await this.prisma.event.findUnique({
        where: { id: numericId }
      });

      if (!existing) {
        this.logger.warn(`editEvent: event with id ${eventId} not found.`);
        return Err(EventNotFound(`Event with id ${eventId} not found.`));
      }

      // Check for event ID mismatch
      if (patch.id && patch.id !== eventId) {
        this.logger.warn(`editEvent: event id mismatch (${patch.id} vs ${eventId}).`);
        return Err(EventIdMismatch("Event ID mismatch."));
      }

      // Simple update - just replace the event
      const updatedEvent = await this.prisma.event.update({
        where: { id: numericId },
        data: {
          organizerId: patch.organizerId!,
          title: patch.title!,
          description: patch.description!,
          location: patch.location!,
          category: patch.category!,
          status: patch.status!,
          startDateTime: patch.startDateTime!,
          endDateTime: patch.endDateTime!,
          capacity: patch.capacity,
          createdAt: patch.createdAt!,
          updatedAt: patch.updatedAt,
        },
      });

      const resultEvent: IEvent = {
        ...updatedEvent,
        id: updatedEvent.id.toString(),
        status: updatedEvent.status as statusType,
        capacity: updatedEvent.capacity ?? undefined,
        updatedAt: updatedEvent.updatedAt ?? undefined,
      };

      this.logger.info(`editEvent: updated event ${eventId} ("${resultEvent.title}").`);
      return Ok(resultEvent);
    } catch (error) {
      this.logger.error(`editEvent failed for ${eventId}: ${error}`);
      return Err(new Error(`Failed to update event: ${error}`));
    }
  }

  async getEvent(eventId: string): Promise<Result<IEvent, Error>> {
    try {
      const numericId = parseInt(eventId, 10);
      
      const event = await this.prisma.event.findUnique({
        where: { id: numericId }
      });

      if (!event) {
        this.logger.warn(`getEvent: event with id ${eventId} not found.`);
        return Err(EventNotFound(`Event with id ${eventId} not found.`));
      }

      const resultEvent: IEvent = {
        ...event,
        id: event.id.toString(),
        status: event.status as statusType,
        capacity: event.capacity ?? undefined,
        updatedAt: event.updatedAt ?? undefined,
      };

      this.logger.info(`getEvent: retrieved event ${eventId}.`);
      return Ok(resultEvent);
    } catch (error) {
      this.logger.error(`getEvent failed for ${eventId}: ${error}`);
      return Err(new Error(`Failed to retrieve event: ${error}`));
    }
  }

  async searchEvents(term: string): Promise<Result<IEvent[], Error>> {
    // Stub - not implemented yet
    throw new Error("searchEvents not implemented");
  }

  async getAllEvents(): Promise<Result<IEvent[], Error>> {
    try {
      const events = await this.prisma.event.findMany();

      const resultEvents: IEvent[] = events.map((event: any) => ({
        ...event,
        id: event.id.toString(),
        status: event.status as statusType,
        capacity: event.capacity ?? undefined,
        updatedAt: event.updatedAt ?? undefined,
      }));

      this.logger.info(`getAllEvents: returning ${resultEvents.length} event(s).`);
      return Ok(resultEvents);
    } catch (error) {
      this.logger.error(`getAllEvents failed: ${error}`);
      return Err(new Error(`Failed to retrieve events: ${error}`));
    }
  }
}

export function CreatePrismaEventRepository(
  logger: ILoggingService,
  prismaClient?: PrismaClient,
): IEventRepository {
  return new PrismaEventRepository(logger, prismaClient);
}
