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
  publishEvent(res: Response, eventId: string, store: AppSessionStore): Promise<void>;
  cancelEvent(res: Response, eventId: string, store: AppSessionStore): Promise<void>;
  showOrganizerDashboard(res: Response, store: AppSessionStore): Promise<void>;
}

/**
 * Shape passed to the organizer-dashboard view for each event row.
 */
interface DashboardEventRow {
  event: IEvent;
  attendeeCount: number;
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
    if (name === "InvalidStateTransition") return 409;
    if (name === "ConflictError") return 409;
    return 500;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Derive the attendee count from the registered-user set on an event.
   */
  private getAttendeeCount(event: IEvent): number {
    if (!event.users || event.users.length === 0) return 0;
    return event.users.reduce((total, set) => total + set.size, 0);
  }

  /**
   * Bucket a flat event list into the three dashboard groups.
   * Published events whose endDateTime has passed land in cancelledOrPast.
   */
  private groupEvents(events: IEvent[]): {
    published: DashboardEventRow[];
    draft: DashboardEventRow[];
    cancelledOrPast: DashboardEventRow[];
  } {
    const now = new Date();
    const published: DashboardEventRow[] = [];
    const draft: DashboardEventRow[] = [];
    const cancelledOrPast: DashboardEventRow[] = [];

    for (const event of events) {
      const row: DashboardEventRow = {
        event,
        attendeeCount: this.getAttendeeCount(event),
      };

      const isPast =
        event.status === "past" ||
        (event.status === "published" && new Date(event.endDateTime) < now);

      if (event.status === "cancelled" || isPast) {
        cancelledOrPast.push(row);
      } else if (event.status === "published") {
        published.push(row);
      } else if (event.status === "draft") {
        draft.push(row);
      }
    }

    return { published, draft, cancelledOrPast };
  }

  async showCreateEventForm(res: Response, session: IAppBrowserSession, pageError: string | null = null): Promise<void> {
    res.render("events/create", { session, pageError, event: null });
  }

  async createEventFromForm(res: Response, input: Partial<IEvent>, store: AppSessionStore): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);
    // Controller responsibility: Check for mandatory fields (non-empty)
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const location = typeof input.location === "string" ? input.location.trim() : "";
    const category = typeof input.category === "string" ? input.category.trim() : "";
    const startDateTimeRaw = typeof input.startDateTime === "string" ? input.startDateTime.trim() : "";
    const endDateTimeRaw = typeof input.endDateTime === "string" ? input.endDateTime.trim() : "";

    if (!title) {
      this.logger.warn("Create event failed: Title is required.");
      res.status(400);
      await this.showCreateEventForm(res, session, "Title is required.");
      return;
    }
    if (!description) {
      this.logger.warn("Create event failed: Description is required.");
      res.status(400);
      await this.showCreateEventForm(res, session, "Description is required.");
      return;
    }
    if (!location) {
      this.logger.warn("Create event failed: Location is required.");
      res.status(400);
      await this.showCreateEventForm(res, session, "Location is required.");
      return;
    }
    if (!category) {
      this.logger.warn("Create event failed: Category is required.");
      res.status(400);
      await this.showCreateEventForm(res, session, "Category is required.");
      return;
    }
    if (!startDateTimeRaw) {
      this.logger.warn("Create event failed: Start date/time is required.");
      res.status(400);
      await this.showCreateEventForm(res, session, "Start date/time is required.");
      return;
    }
    if (!endDateTimeRaw) {
      this.logger.warn("Create event failed: End date/time is required.");
      res.status(400);
      await this.showCreateEventForm(res, session, "End date/time is required.");
      return;
    }
    // Parse dates for service 
    const startDate = new Date(startDateTimeRaw);
    const endDate = new Date(endDateTimeRaw);
    const createdAt = new Date();
    // Handle capacity conversion (empty = undefined)
    let capacity: number | undefined;
    if (input.capacity !== undefined && String(input.capacity).trim() !== "") {
      capacity = typeof input.capacity === "number" 
        ? input.capacity 
        : parseInt(String(input.capacity), 10);
    }

    const eventForm: Partial<IEvent> = {
      organizerId: currentUser!.userId,
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

    this.logger.info(`Event created ${result.value.id} by ${currentUser!.userId}`);
    res.redirect("/home");
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
    // Controller responsibility: Check for eventId
    if (!eventId) {
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Missing event id.");
      return;
    }

    // Controller responsibility: Check for mandatory fields (non-empty)
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const location = typeof input.location === "string" ? input.location.trim() : "";
    const category = typeof input.category === "string" ? input.category.trim() : "";
    const startDateTimeRaw = typeof input.startDateTime === "string" ? input.startDateTime.trim() : "";
    const endDateTimeRaw = typeof input.endDateTime === "string" ? input.endDateTime.trim() : "";

    if (!title) {
      this.logger.warn("Modify event failed: Title is required.");
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Title is required.");
      return;
    }
    if (!description) {
      this.logger.warn("Modify event failed: Description is required.");
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Description is required.");
      return;
    }
    if (!location) {
      this.logger.warn("Modify event failed: Location is required.");
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Location is required.");
      return;
    }
    if (!category) {
      this.logger.warn("Modify event failed: Category is required.");
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Category is required.");
      return;
    }
    if (!startDateTimeRaw) {
      this.logger.warn("Modify event failed: Start date/time is required.");
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "Start date/time is required.");
      return;
    }
    if (!endDateTimeRaw) {
      this.logger.warn("Modify event failed: End date/time is required.");
      res.status(400);
      await this.showEditEventForm(res, eventId, session, "End date/time is required.");
      return;
    }

    // Parse dates for service 
    const startDate = new Date(startDateTimeRaw);
    const endDate = new Date(endDateTimeRaw);

    // Handle capacity conversion (empty = undefined)
    let capacity: number | undefined;
    if (input.capacity !== undefined && String(input.capacity).trim() !== "") {
      capacity = typeof input.capacity === "number" 
        ? input.capacity 
        : parseInt(String(input.capacity), 10);
    }

    // Build patch with raw data - service will validate everything
    const patch: Partial<IEvent> = {
      title,
      description,
      location,
      category,
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      capacity,
      updatedAt: new Date().toISOString(),
    };

    // Include status if provided (service will validate)
    if (input.status !== undefined) {
      patch.status = input.status;
    }

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

    this.logger.info(`Event ${eventId} modified by ${currentUser!.userId}`);
    res.redirect("/home");
  }

  // ── Lifecycle transitions (Feature 5, Sprint 1) ───────────────────

  async publishEvent(res: Response, eventId: string, store: AppSessionStore): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    if (!currentUser || (currentUser.role !== "staff" && currentUser.role !== "admin")) {
      const msg = "Only Staff or Admin can publish events.";
      this.logger.warn(`Blocked publish attempt by ${currentUser?.role ?? "unauthenticated"}`);
      res.status(403).render("partials/error", { message: msg, layout: false });
      return;
    }

    const result = await this.service.publishEvent(eventId, currentUser.userId, currentUser.role);

    if (result.ok === false) {
      const err = result.value;
      const httpStatus = this.mapErrorStatus(err);
      this.logger.warn(`Publish event ${eventId} failed: ${err.message}`);
      res.status(httpStatus).render("partials/error", { message: err.message, layout: false });
      return;
    }

    this.logger.info(`Event ${eventId} published by ${currentUser.userId}`);
    res.redirect("/home");
  }

  async cancelEvent(res: Response, eventId: string, store: AppSessionStore): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    if (!currentUser || (currentUser.role !== "staff" && currentUser.role !== "admin")) {
      const msg = "Only Staff or Admin can cancel events.";
      this.logger.warn(`Blocked cancel attempt by ${currentUser?.role ?? "unauthenticated"}`);
      res.status(403).render("partials/error", { message: msg, layout: false });
      return;
    }

    const result = await this.service.cancelEvent(eventId, currentUser.userId, currentUser.role);

    if (result.ok === false) {
      const err = result.value;
      const httpStatus = this.mapErrorStatus(err);
      this.logger.warn(`Cancel event ${eventId} failed: ${err.message}`);
      res.status(httpStatus).render("partials/error", { message: err.message, layout: false });
      return;
    }

    this.logger.info(`Event ${eventId} cancelled by ${currentUser.userId}`);
    res.redirect("/home");
  }

 async showOrganizerDashboard(res: Response, store: AppSessionStore): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    // Defensive — route-level check should already block, but just in case
    if (!currentUser || (currentUser.role !== "staff" && currentUser.role !== "admin")) {
      const msg = "Only Staff or Admin can access the organizer dashboard.";
      this.logger.warn(
        `Blocked dashboard access by ${currentUser?.role ?? "unauthenticated"}`,
      );
      res.status(403).render("partials/error", { message: msg, layout: false });
      return;
    }

    // Use the correct service method based on role
    const eventsResult =
      currentUser.role === "admin"
        ? await this.service.getEventsAdmin()
        : await this.service.getOrganizerEvents(currentUser.userId);

    if (eventsResult.ok === false) {
      const err = eventsResult.value;
      const httpStatus = this.mapErrorStatus(err);
      this.logger.warn(`Organizer dashboard failed: ${err.message}`);
      res.status(httpStatus).render("partials/error", { message: err.message, layout: false });
      return;
    }

    const groups = this.groupEvents(eventsResult.value);

    this.logger.info(
      `Organizer dashboard for ${currentUser.userId}: ` +
      `${groups.published.length} published, ${groups.draft.length} draft, ` +
      `${groups.cancelledOrPast.length} cancelled/past`,
    );

    res.render("events/organizer-dashboard", {
      session,
      pageError: null,
      published: groups.published,
      draft: groups.draft,
      cancelledOrPast: groups.cancelledOrPast,
    });
  }
}

export function CreateEventController(service: IEventService, logger: ILoggingService): IEventController {
  return new EventController(service, logger);
}