// src/controller/EventController.ts

import type { Response } from "express";
import {
  getAuthenticatedUser,
  touchAppSession,
  type IAppBrowserSession,
  type AppSessionStore,
} from "../session/AppSession";
import type { ILoggingService } from "../service/LoggingService";
import type { Result } from "../lib/result";
import type { IEventService } from "../service/EventService";
import type { statusType, IEvent, IRSVP } from "../repository/EventRepository";


/**
 * Controller interface
 */
export interface IEventController {
  showCreateEventForm(res: Response, session: IAppBrowserSession, pageError?: string | null): Promise<void>;
  createEventFromForm(res: Response, input: Partial<IEvent>, store: AppSessionStore): Promise<void>;
  showEditEventForm(res: Response, eventId: string, session: IAppBrowserSession, pageError?: string | null): Promise<void>;
  modifyEventFromForm(res: Response, eventId: string, input: Partial<IEvent>, store: AppSessionStore): Promise<void>;
}

/**
 * Controller implementation
 *
 * Notes / assumptions:
 * - Route-level role checks should already block members; controller performs defensive checks too.
 * - Views:
 *   - "events/create" used to render the create page
 *   - "events/edit" used to render the edit page
 *   - "partials/error" used for HTMX / partial error responses
 * - Service methods return Result<T> as defined above.
 */
class EventController implements IEventController {
  constructor(private readonly service: IEventService, private readonly logger: ILoggingService) {}

  private mapErrorStatus(error: Error): number {
    // Map some common error names to HTTP statuses; adapt to your service errors if different.
    const name = (error as any).name;
    if (name === "AuthorizationRequired") return 403;
    if (name === "EventNotFound") return 404;
    if (name === "ValidationError" || name === "InvalidInput") return 400;
    if (name === "ConflictError") return 409;
    return 500;
  }

  async showCreateEventForm(res: Response, session: IAppBrowserSession, pageError: string | null = null): Promise<void> {
    res.render("events/create", { session, pageError, event: null });
  }

  async createEventFromForm(res: Response, input: Partial<IEvent>, store: AppSessionStore): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    // Defensive role check
    if (!currentUser || (currentUser.role !== "staff" && currentUser.role !== "admin")) {
      const msg = "Only Staff or Admin can create events.";
      this.logger.warn(`Blocked event creation attempt by ${currentUser?.role ?? "unauthenticated"}`);
      res.status(403).render("partials/error", { message: msg, layout: false });
      return;
    }

    // Required fields
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const location = typeof input.location === "string" ? input.location.trim() : "";
    const category = typeof input.category === "string" ? input.category.trim() : "";
    const startDateTimeRaw = typeof input.startDateTime === "string" ? input.startDateTime.trim() : "";
    const endDateTimeRaw = typeof input.endDateTime === "string" ? input.endDateTime.trim() : "";

    if (!title) {
      res.status(400);
      await this.showCreateEventForm(res, session, "Title is required.");
      return;
    }
    if (!startDateTimeRaw) {
      res.status(400);
      await this.showCreateEventForm(res, session, "Start date/time is required.");
      return;
    }
    if (!endDateTimeRaw) {
      res.status(400);
      await this.showCreateEventForm(res, session, "End date/time is required.");
      return;
    }

    // Parse datetimes and validate chronology
    const createdAt = new Date();
    const startDate = new Date(startDateTimeRaw);
    const endDate = new Date(endDateTimeRaw);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      res.status(400);
      await this.showCreateEventForm(res, session, "Invalid date/time format.");
      return;
    }

    if (startDate < createdAt) {
      res.status(400);
      await this.showCreateEventForm(res, session, "Event start cannot be before creation time.");
      return;
    }

    if (startDate >= endDate) {
      res.status(400);
      await this.showCreateEventForm(res, session, "Event start must be before end time.");
      return;
    }

    // Capacity validation if provided
    let capacity: number | undefined;
    if (input.capacity !== undefined) {
      const parsed = typeof input.capacity === "number" ? input.capacity : parseInt(String(input.capacity), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400);
        await this.showCreateEventForm(res, session, "Capacity must be a positive non-zero number.");
        return;
      }
      capacity = parsed;
    }

    // Build event object (service is responsible for id generation)
    const eventForm: Partial<IEvent> = {
      organizerId: currentUser.userId,
      title,
      description,
      location,
      category,
      status: "draft",
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      capacity,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };

    const result = await this.service.createEvent(eventForm);

    if (result.ok === false) {
      const err = result.value;
      const status = this.mapErrorStatus(err);
      const log = status >= 500 ? this.logger.error : this.logger.warn;
      log.call(this.logger, `Create event failed: ${err.message}`);
      res.status(status);
      await this.showCreateEventForm(res, session, err.message);
      return;
    }

    this.logger.info(`Event created ${result.value.id} by ${currentUser.userId}`);
    res.redirect("/events");
  }

  async showEditEventForm(res: Response, eventId: string, session: IAppBrowserSession, pageError: string | null = null): Promise<void> {
    const fetched = await this.service.getEvent(eventId);
    if (fetched.ok === false) {
      const err = fetched.value;
      const status = this.mapErrorStatus(err);
      this.logger.warn(`Failed to fetch event ${eventId}: ${err.message}`);
      res.status(status).render("events/edit", { session, pageError: err.message, event: null });
      return;
    }

    res.render("events/edit", { session, pageError, event: fetched.value });
  }

  async modifyEventFromForm(res: Response, eventId: string, input: Partial<IEvent>, store: AppSessionStore): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    // Defensive role check
    if (!currentUser || (currentUser.role !== "staff" && currentUser.role !== "admin")) {
      const msg = "Only Staff or Admin can modify events.";
      this.logger.warn(`Blocked event modification attempt by ${currentUser?.role ?? "unauthenticated"}`);
      res.status(403).render("partials/error", { message: msg, layout: false });
      return;
    }

    if (!eventId) {
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Missing event id.");
      return;
    }

    // Fetch existing event to apply business rules
    const existingRes = await this.service.getEvent(eventId);
    if (existingRes.ok === false) {
      const err = existingRes.value;
      const status = this.mapErrorStatus(err);
      this.logger.warn(`Failed to fetch event ${eventId} for modification: ${err.message}`);
      res.status(status);
      await this.showEditEventForm(res, eventId, session, err.message);
      return;
    }

    const existing = existingRes.value;

    // No edits allowed to cancelled or past events
    if (existing.status === "cancelled") {
      res.status(409);
      await this.showEditEventForm(res, eventId, session, "Cannot modify a cancelled event.");
      return;
    }
    const now = new Date();
    const existingStart = new Date(existing.startDateTime);
    if (existingStart < now) {
      res.status(409);
      await this.showEditEventForm(res, eventId, session, "Cannot modify a past event.");
      return;
    }

    // Build patch only including provided fields and validate them
    const patch: Partial<IEvent> = {};
    if (typeof input.title === "string") patch.title = input.title.trim();
    if (typeof input.description === "string") patch.description = input.description.trim();
    if (typeof input.location === "string") patch.location = input.location.trim();
    if (typeof input.category === "string") patch.category = input.category.trim();

    if (input.startDateTime !== undefined) {
      const parsed = new Date(String(input.startDateTime));
      if (Number.isNaN(parsed.getTime())) {
        res.status(400);
        await this.showEditEventForm(res, eventId, session, "Invalid start date/time.");
        return;
      }
      // start must not be before now
      if (parsed < now) {
        res.status(400);
        await this.showEditEventForm(res, eventId, session, "Start date/time cannot be in the past.");
        return;
      }
      patch.startDateTime = parsed.toISOString();
    }

    if (input.endDateTime !== undefined) {
      const parsed = new Date(String(input.endDateTime));
      if (Number.isNaN(parsed.getTime())) {
        res.status(400);
        await this.showEditEventForm(res, eventId, session, "Invalid end date/time.");
        return;
      }
      patch.endDateTime = parsed.toISOString();
    }

    // If both start & end provided, check chronology. If only one provided, compare with existing value.
    const effectiveStart = patch.startDateTime ? new Date(patch.startDateTime) : new Date(existing.startDateTime);
    const effectiveEnd = patch.endDateTime ? new Date(patch.endDateTime) : new Date(existing.endDateTime);
    if (effectiveStart >= effectiveEnd) {
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Event start must be before end time.");
      return;
    }

    // Capacity if provided
    if (input.capacity !== undefined) {
      const parsed = typeof input.capacity === "number" ? input.capacity : parseInt(String(input.capacity), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400);
        await this.showEditEventForm(res, eventId, session, "Capacity must be a positive non-zero number.");
        return;
      }
      patch.capacity = parsed;
    }

    // Status transition allowed by service; we still accept explicit status if well-formed
    if (input.status !== undefined) {
      if (input.status === "published" || input.status === "draft" || input.status === "cancelled" || input.status === "past") {
        patch.status = input.status;
      } else {
        res.status(400);
        await this.showEditEventForm(res, eventId, session, "Invalid status.");
        return;
      }
    }

    patch.updatedAt = new Date().toISOString();

    // Delegate to service
    const result = await this.service.modifyEvent(eventId, patch);

    if (result.ok === false) {
      const err = result.value;
      const status = this.mapErrorStatus(err);
      const log = status >= 500 ? this.logger.error : this.logger.warn;
      log.call(this.logger, `Modify event failed: ${err.message}`);
      res.status(status);
      await this.showEditEventForm(res, eventId, session, err.message);
      return;
    }

    this.logger.info(`Event ${eventId} modified by ${currentUser.userId}`);
    res.redirect(`/events/${eventId}`);
  }
}

export function CreateEventController(service: IEventService, logger: ILoggingService): IEventController {
  return new EventController(service, logger);
}