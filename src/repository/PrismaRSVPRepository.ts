import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Result, Ok, Err } from "../lib/result";
import type { IRSVP } from "./EventRepository";
import type { IRSVPRepository } from "./RSVPRepository";
import type { ILoggingService } from "../service/LoggingService";
import {
  RSVPNotFound,
  RSVPStateError,
} from "../lib/error";

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

class PrismaRSVPRepository implements IRSVPRepository {
  private prisma: PrismaClient;

  constructor(
    private readonly logger: ILoggingService,
    prismaClient?: PrismaClient,
  ) {
    this.prisma = prismaClient || prisma;
  }

  private toRSVP(record: {
    id: string;
    eventId: number;
    userId: string;
    status: string;
    createdAt: string;
  }): IRSVP {
    return {
      id: record.id,
      eventId: record.eventId.toString(),
      userId: record.userId,
      status: record.status as IRSVP["status"],
      createdAt: record.createdAt,
    };
  }

  private parseEventId(eventId: string): Result<number, Error> {
    const numericEventId = Number.parseInt(eventId, 10);

    if (Number.isNaN(numericEventId)) {
      return Err(new Error(`Invalid event id: ${eventId}`));
    }

    return Ok(numericEventId);
  }

  async addRSVP(rsvp: IRSVP): Promise<Result<IRSVP, Error>> {
    try {
      const eventIdResult = this.parseEventId(rsvp.eventId);

      if (eventIdResult.ok === false) {
        return Err(eventIdResult.value);
      }

      const created = await this.prisma.rSVP.create({
        data: {
          id: rsvp.id,
          eventId: eventIdResult.value,
          userId: rsvp.userId,
          status: rsvp.status,
          createdAt: rsvp.createdAt,
        },
      });

      const result = this.toRSVP(created);
      this.logger.info(`addRSVP: stored RSVP ${result.id}.`);
      return Ok(result);
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
      const eventIdResult = this.parseEventId(eventId);

      if (eventIdResult.ok === false) {
        return Err(eventIdResult.value);
      }

      const rsvp = await this.prisma.rSVP.findUnique({
        where: {
          userId_eventId: {
            eventId: eventIdResult.value,
            userId,
          },
        },
      });

      if (!rsvp) {
        this.logger.info(
          `getRSVPByUserAndEvent: no RSVP found for user ${userId} on event ${eventId}.`,
        );
        return Ok(null);
      }

      const result = this.toRSVP(rsvp);
      this.logger.info(
        `getRSVPByUserAndEvent: found RSVP for user ${userId} on event ${eventId}.`,
      );
      return Ok(result);
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
      const updated = await this.prisma.rSVP.update({
        where: { id: rsvpId },
        data: { status },
      });

      const result = this.toRSVP(updated);
      this.logger.info(`updateRSVPStatus: updated RSVP ${rsvpId} to ${status}.`);
      return Ok(result);
    } catch (error) {
      this.logger.error(`updateRSVPStatus failed for ${rsvpId}: ${error}`);
      return Err(new Error(`Failed to update RSVP: ${error}`));
    }
  }

  async getRSVPsByEvent(eventId: string): Promise<Result<IRSVP[], Error>> {
    try {
      const eventIdResult = this.parseEventId(eventId);

      if (eventIdResult.ok === false) {
        return Err(eventIdResult.value);
      }

      const rsvps = await this.prisma.rSVP.findMany({
        where: { eventId: eventIdResult.value },
        orderBy: { createdAt: "asc" },
      });

      const results = rsvps.map((rsvp) => this.toRSVP(rsvp));
      this.logger.info(
        `getRSVPsByEvent: found ${results.length} RSVPs for event ${eventId}.`,
      );
      return Ok(results);
    } catch (error) {
      this.logger.error(`getRSVPsByEvent failed for event ${eventId}: ${error}`);
      return Err(new Error(`Failed to retrieve event RSVPs: ${error}`));
    }
  }

  async getRSVPsByUser(userId: string): Promise<Result<IRSVP[], Error>> {
    try {
      const rsvps = await this.prisma.rSVP.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });

      const results = rsvps.map((rsvp) => this.toRSVP(rsvp));
      this.logger.info(
        `getRSVPsByUser: found ${results.length} RSVPs for user ${userId}.`,
      );
      return Ok(results);
    } catch (error) {
      this.logger.error(`getRSVPsByUser failed for user ${userId}: ${error}`);
      return Err(new Error(`Failed to retrieve user RSVPs: ${error}`));
    }
  }

  async cancelRSVPWithPromotion(
    eventId: string,
    userId: string,
  ): Promise<Result<{ cancelled: IRSVP; promoted?: IRSVP }, Error>> {
    try {
      const eventIdResult = this.parseEventId(eventId);

      if (eventIdResult.ok === false) {
        return Err(eventIdResult.value);
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.rSVP.findUnique({
          where: {
            userId_eventId: {
              eventId: eventIdResult.value,
              userId,
            },
          },
        });

        if (!existing) {
          return Err(RSVPNotFound("RSVP not found."));
        }

        if (existing.status === "cancelled") {
          return Err(RSVPStateError("RSVP is already cancelled."));
        }

        const cancelled = await tx.rSVP.update({
          where: { id: existing.id },
          data: { status: "cancelled" },
        });

        const cancelledRSVP = this.toRSVP(cancelled);

        if (existing.status !== "going") {
          return Ok({ cancelled: cancelledRSVP });
        }

        const nextWaitlisted = await tx.rSVP.findFirst({
          where: {
            eventId: eventIdResult.value,
            status: "waitlisted",
          },
          orderBy: { createdAt: "asc" },
        });

        if (!nextWaitlisted) {
          return Ok({ cancelled: cancelledRSVP });
        }

        const promoted = await tx.rSVP.update({
          where: { id: nextWaitlisted.id },
          data: { status: "going" },
        });

        return Ok({
          cancelled: cancelledRSVP,
          promoted: this.toRSVP(promoted),
        });
      });

      this.logger.info(
        `cancelRSVPWithPromotion: cancelled RSVP for user ${userId} on event ${eventId}.`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `cancelRSVPWithPromotion failed for user ${userId} on event ${eventId}: ${error}`,
      );
      return Err(new Error(`Failed to cancel RSVP with promotion: ${error}`));
    }
  }
}

export function CreatePrismaRSVPRepository(
  logger: ILoggingService,
  prismaClient?: PrismaClient,
): IRSVPRepository {
  return new PrismaRSVPRepository(logger, prismaClient);
}
