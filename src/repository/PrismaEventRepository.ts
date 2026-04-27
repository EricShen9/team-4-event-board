import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Result, Ok, Err } from "../lib/result";
import type { IEvent, IEventRepository } from "./EventRepository";
import type { ILoggingService } from "../service/LoggingService";
import { EventAlreadyExists } from "../lib/error";
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
        this.logger.warn(`addEvent: event already exists.`);
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
    throw new Error("editEvent not implemented");
  }

  async getEvent(eventId: string): Promise<Result<IEvent, Error>> {
    throw new Error("getEvent not implemented");
  }

  async searchEvents(term: string): Promise<Result<IEvent[], Error>> {
    throw new Error("searchEvents not implemented");
  }

  async getAllEvents(): Promise<Result<IEvent[], Error>> {
    throw new Error("getAllEvents not implemented");
  }
}

export function CreatePrismaEventRepository(
  logger: ILoggingService,
  prismaClient?: PrismaClient,
): IEventRepository {
  return new PrismaEventRepository(logger, prismaClient);
}