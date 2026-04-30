import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Result, Ok, Err } from "../lib/result";
import type { IRSVP, RSVPStatusType } from "./EventRepository";
import type { IRSVPRepository } from "./RSVPRepository";
import type { ILoggingService } from "../service/LoggingService";
import { RSVPNotFound } from "../lib/error";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function toDomainRSVP(rsvp: {
  id: string;
  eventId: number;
  userId: string;
  status: string;
  createdAt: string;
}): IRSVP {
  return {
    id: rsvp.id,
    eventId: rsvp.eventId.toString(),
    userId: rsvp.userId,
    status: rsvp.status as RSVPStatusType,
    createdAt: rsvp.createdAt,
  };
}

class PrismaRSVPRepository implements IRSVPRepository {
  private prisma: PrismaClient;

  constructor(
    private readonly logger: ILoggingService,
    prismaClient?: PrismaClient,
  ) {
    this.prisma = prismaClient || prisma;
  }

  async addRSVP(rsvp: IRSVP): Promise<Result<IRSVP, Error>> {
    try {
      const eventId = parseInt(rsvp.eventId, 10);

      if (Number.isNaN(eventId)) {
        return Err(new Error("Invalid event id."));
      }

      const created = await this.prisma.rSVP.create({
        data: {
          id: rsvp.id,
          eventId,
          userId: rsvp.userId,
          status: rsvp.status,
          createdAt: rsvp.createdAt,
        },
      });

      this.logger.info(`addRSVP: stored RSVP ${created.id}.`);
      return Ok(toDomainRSVP(created));
    } catch (error) {
      this.logger.error(`addRSVP failed: ${error}`);
      return Err(new Error(`Failed to create RSVP: ${error}`));
    }
  }

  async getRSVPByUserAndEvent(
    userId: string,
    eventId: string,
  ): Promise<Result<IRSVP | null, Error>> {
    try {
      const numericEventId = parseInt(eventId, 10);

      if (Number.isNaN(numericEventId)) {
        return Err(new Error("Invalid event id."));
      }

      const rsvp = await this.prisma.rSVP.findUnique({
        where: {
          userId_eventId: {
            userId,
            eventId: numericEventId,
          },
        },
      });

      if (!rsvp) {
        this.logger.info(
          `getRSVPByUserAndEvent: no RSVP found for user ${userId} on event ${eventId}.`,
        );
        return Ok(null);
      }

      this.logger.info(
        `getRSVPByUserAndEvent: found RSVP for user ${userId} on event ${eventId}.`,
      );
      return Ok(toDomainRSVP(rsvp));
    } catch (error) {
      this.logger.error(`getRSVPByUserAndEvent failed: ${error}`);
      return Err(new Error(`Failed to retrieve RSVP: ${error}`));
    }
  }

  async updateRSVPStatus(
    rsvpId: string,
    status: IRSVP["status"],
  ): Promise<Result<IRSVP, Error>> {
    try {
      const existing = await this.prisma.rSVP.findUnique({
        where: { id: rsvpId },
      });

      if (!existing) {
        this.logger.warn(`updateRSVPStatus: RSVP with id ${rsvpId} not found.`);
        return Err(RSVPNotFound(`RSVP with id ${rsvpId} not found.`));
      }

      const updated = await this.prisma.rSVP.update({
        where: { id: rsvpId },
        data: { status },
      });

      this.logger.info(
        `updateRSVPStatus: updated RSVP ${rsvpId} to status ${status}.`,
      );
      return Ok(toDomainRSVP(updated));
    } catch (error) {
      this.logger.error(`updateRSVPStatus failed: ${error}`);
      return Err(new Error(`Failed to update RSVP: ${error}`));
    }
  }

  async getRSVPsByEvent(eventId: string): Promise<Result<IRSVP[], Error>> {
    try {
      const numericEventId = parseInt(eventId, 10);

      if (Number.isNaN(numericEventId)) {
        return Err(new Error("Invalid event id."));
      }

      const rsvps = await this.prisma.rSVP.findMany({
        where: {
          eventId: numericEventId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      this.logger.info(
        `getRSVPsByEvent: found ${rsvps.length} RSVPs for event ${eventId}.`,
      );
      return Ok(rsvps.map(toDomainRSVP));
    } catch (error) {
      this.logger.error(`getRSVPsByEvent failed: ${error}`);
      return Err(new Error(`Failed to retrieve RSVPs by event: ${error}`));
    }
  }

  async getRSVPsByUser(userId: string): Promise<Result<IRSVP[], Error>> {
    try {
      const rsvps = await this.prisma.rSVP.findMany({
        where: {
          userId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      this.logger.info(
        `getRSVPsByUser: found ${rsvps.length} RSVPs for user ${userId}.`,
      );
      return Ok(rsvps.map(toDomainRSVP));
    } catch (error) {
      this.logger.error(`getRSVPsByUser failed: ${error}`);
      return Err(new Error(`Failed to retrieve RSVPs by user: ${error}`));
    }
  }
}

export function CreatePrismaRSVPRepository(
  logger: ILoggingService,
  prismaClient?: PrismaClient,
): IRSVPRepository {
  return new PrismaRSVPRepository(logger, prismaClient);
}