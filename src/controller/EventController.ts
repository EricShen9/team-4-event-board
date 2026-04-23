// src/controller/EventController.ts

import type { Response } from "express";
import {
  getAuthenticatedUser,
  touchAppSession,
  type IAppBrowserSession,
  type AppSessionStore,
} from "../session/AppSession";
import type { ILoggingService } from "../service/LoggingService";
import type { IEventService } from "../service/EventService";
import type { statusType, IEvent, IRSVP } from "../repository/EventRepository";
import { 
  EventValidationError, 
} from "../lib/error"
/**
 * Controller interface
 */
export interface IEventController {
  showSearchPage(res: Response, session: IAppBrowserSession, query: string, pageError?: string | null): Promise<void>;
  showCreateEventForm(res: Response, session: IAppBrowserSession, pageError?: string | null): Promise<void>;
  createEventFromForm(res: Response, input: Partial<IEvent>, store: AppSessionStore): Promise<void>;
  showEditEventForm(res: Response, eventId: string, session: IAppBrowserSession, pageError?: string | null): Promise<void>;
  modifyEventFromForm(res: Response, eventId: string, input: Partial<IEvent>, store: AppSessionStore): Promise<void>;
  publishEvent(res: Response, eventId: string, store: AppSessionStore): Promise<void>;
  cancelEvent(res: Response, eventId: string, store: AppSessionStore): Promise<void>;
  showOrganizerDashboard(res: Response, store: AppSessionStore): Promise<void>;
  showEventDetail(res: Response, eventId: string, store: AppSessionStore, pageError?: string | null): Promise<void>;
  showEventList(res: Response, store: AppSessionStore, category?: string, timeframe?: string, pageError?: string | null, isHtmx?: boolean): Promise<void>;
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
    // Auth errors (mirrors AuthController pattern)
    if (error.name === "AuthenticationRequired") return 401;
    if (error.name === "AuthorizationRequired") return 403;
    
    // Event errors
    if (error.name === "EventAuthorizationError") return 403;
    if (error.name === "EventNotFound") return 404;
    if (error.name === "EventAlreadyExists") return 409;
    if (error.name === "EventValidationError") return 400;
    if (error.name === "EventStateError") return 409;
    if (error.name === "InvalidStateTransition") return 409;
    
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
    // Always render the form partial (no layout)
    res.render("events/create", { session, pageError, event: null });
  }

  async createEventFromForm(res: Response, input: Partial<IEvent>, store: AppSessionStore): Promise<void> {
    const currentUser = getAuthenticatedUser(store);
    
    // Form validation only (required fields, basic format)
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const location = typeof input.location === "string" ? input.location.trim() : "";
    const category = typeof input.category === "string" ? input.category.trim() : "";
    const startDateTimeRaw = typeof input.startDateTime === "string" ? input.startDateTime.trim() : "";
    const endDateTimeRaw = typeof input.endDateTime === "string" ? input.endDateTime.trim() : "";

    if (!title) {
      const err = EventValidationError("Title is required.");
      this.logger.warn(`Create event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!description) {
      const err = EventValidationError("Description is required.");
      this.logger.warn(`Create event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!location) {
      const err = EventValidationError("Location is required.");
      this.logger.warn(`Create event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!category) {
      const err = EventValidationError("Category is required.");
      this.logger.warn(`Create event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!startDateTimeRaw) {
      const err = EventValidationError("Start date/time is required.");
      this.logger.warn(`Create event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!endDateTimeRaw) {
      const err = EventValidationError("End date/time is required.");
      this.logger.warn(`Create event failed: ${err.message}`);
      res.status(400);  
      return res.render("partials/error", { message: err.message, layout: false });
    }
    
    // Convert to ISO strings (format conversion, not business logic)
    const startDate = new Date(startDateTimeRaw);
    const endDate = new Date(endDateTimeRaw);
    
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
      createdAt: new Date().toISOString(),
    };

    const result = await this.service.createEvent(eventForm);
    if (result.ok === false) {
      const err = result.value;
      const status = this.mapErrorStatus(err);
      const log = status >= 500 ? this.logger.error : this.logger.warn;
      log.call(this.logger, `Create event failed: ${err.message}`);
      res.status(status);
      return res.render("partials/error", { message: err.message, layout: false });
    }

    this.logger.info(`Event created ${result.value.id} by ${currentUser!.userId}`);
    return res.render("partials/success", { 
      message: "Event created successfully! Redirecting...",
      redirectUrl: "/home",
      layout: false,
    });
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
    const currentUser = getAuthenticatedUser(store);
    
    // Check for eventId
    if (!eventId) {
      const err = EventValidationError("Missing event id.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }

    // Input validation only
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const location = typeof input.location === "string" ? input.location.trim() : "";
    const category = typeof input.category === "string" ? input.category.trim() : "";
    const startDateTimeRaw = typeof input.startDateTime === "string" ? input.startDateTime.trim() : "";
    const endDateTimeRaw = typeof input.endDateTime === "string" ? input.endDateTime.trim() : "";
    const status = typeof input.status === "string" ? input.status.trim() : "";

    if (!title) {
      const err = EventValidationError("Title is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!description) {
      const err = EventValidationError("Description is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!location) {
      const err = EventValidationError("Location is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!category) {
      const err = EventValidationError("Category is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!startDateTimeRaw) {
      const err = EventValidationError("Start date/time is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!endDateTimeRaw) {
      const err = EventValidationError("End date/time is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }
    if (!status) {
      const err = EventValidationError("Status is required.");
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }

    // Convert to ISO strings (format conversion)
    const startDate = new Date(startDateTimeRaw);
    const endDate = new Date(endDateTimeRaw);
    
    // Handle capacity conversion (empty = undefined)
    let capacity: number | undefined;
    if (input.capacity !== undefined && String(input.capacity).trim() !== "") {
      capacity = typeof input.capacity === "number" 
        ? input.capacity 
        : parseInt(String(input.capacity), 10);
    }

    // Check that status is of StatusType
    const validStatuses: statusType[] = ["draft", "published", "cancelled", "past"];
    if (!validStatuses.includes(status as statusType)) {
      const err = EventValidationError(`Invalid status. Status must be one of: ${validStatuses.join(", ")}`);
      this.logger.warn(`Modify event failed: ${err.message}`);
      res.status(400);
      return res.render("partials/error", { message: err.message, layout: false });
    }

    // Build patch with formatted data
    const patch: Partial<IEvent> = {
      title,
      description,
      location,
      category,
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      capacity,
      status: status as statusType,
      updatedAt: new Date().toISOString(),
    };

    const result = await this.service.modifyEvent(eventId, patch);

    if (result.ok === false) {
      const err = result.value;
      const status = this.mapErrorStatus(err);
      const log = status >= 500 ? this.logger.error : this.logger.warn;
      log.call(this.logger, `Modify event failed: ${err.message}`);
      res.status(status);
      return res.render("partials/error", { message: err.message, layout: false });
    }

    this.logger.info(`Event ${eventId} modified by ${currentUser!.userId}`);
    return res.render("partials/success", { 
      message: "Event modified successfully! Redirecting...",
      redirectUrl: "/home",
      layout: false,
    });
  }

  async showSearchPage(
    res: Response,
    session: IAppBrowserSession,
    query: string,
    pageError: string | null = null,
  ): Promise<void> {
    const result = await this.service.searchEvents(query);

    if (result.ok === false) {
      const err = result.value;
      const status = this.mapErrorStatus(err);
      this.logger.warn(`Search events failed: ${err.message}`);
      res.status(status).render("events/search", {
        session,
        pageError: err.message,
        query,
        events: [],
      });
      return;
    }

    res.render("events/search", {
      session,
      pageError,
      query,
      events: result.value,
    });
  }

  // ── Lifecycle transitions (Feature 5) ───────────────────

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
      this.logger.warn(`Publish event ${eventId} failed: ${err.message}`);

      // Re-fetch event so we can render inline controls with the error
      const eventResult = await this.service.getEvent(eventId);
      if (eventResult.ok) {
        res.render("events/partials/event-status-controls", {
          event: eventResult.value,
          session,
          actionError: err.message,
          actionSuccess: null,
          layout: false,
        });
      } else {
        const httpStatus = this.mapErrorStatus(err);
        res.status(httpStatus).render("partials/error", { message: err.message, layout: false });
      }
      return;
    }

    this.logger.info(`Event ${eventId} published by ${currentUser.userId}`);
    res.render("events/partials/event-status-controls", {
      event: result.value,
      session,
      actionError: null,
      actionSuccess: "Event published successfully!",
      layout: false,
    });
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
      this.logger.warn(`Cancel event ${eventId} failed: ${err.message}`);

      // Re-fetch event so we can render inline controls with the error
      const eventResult = await this.service.getEvent(eventId);
      if (eventResult.ok) {
        res.render("events/partials/event-status-controls", {
          event: eventResult.value,
          session,
          actionError: err.message,
          actionSuccess: null,
          layout: false,
        });
      } else {
        const httpStatus = this.mapErrorStatus(err);
        res.status(httpStatus).render("partials/error", { message: err.message, layout: false });
      }
      return;
    }

    this.logger.info(`Event ${eventId} cancelled by ${currentUser.userId}`);
    res.render("events/partials/event-status-controls", {
      event: result.value,
      session,
      actionError: null,
      actionSuccess: "Event cancelled.",
      layout: false,
    });
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

  // Feature 2: Event Detail Page
  async showEventDetail(
    res: Response,
    eventId: string,
    store: AppSessionStore,
    pageError: string | null = null,
  ): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    if (!currentUser) {
      res.status(401).render("partials/error", {
        message: "Please log in to view this event.",
        layout: false,
      });
      return;
    }

    const result = await this.service.getEventById(
      eventId,
      currentUser.userId,
      currentUser.role,
    );

    if (result.ok === false) {
      const err = result.value;
      this.logger.warn(`showEventDetail: ${err.message}`);
      res.status(404).render("partials/error", {
        message: "Event not found.",
        layout: false,
      });
      return;
    }

    res.render("events/detail", {
      session,
      pageError,
      event: result.value,
    });
  }

  // Feature 6: Category and Date Filter


  async showEventList(
    res: Response,
    store: AppSessionStore,
    category?: string,
    timeframe?: string,
    pageError: string | null = null,
    isHtmx: boolean = false,
  ): Promise<void> {
    const session = touchAppSession(store);

    const result = await this.service.filterEvents({ category, timeframe });

    const events = result.ok ? result.value : [];
    const error = result.ok ? null : result.value.message;
    const filterState = { category: category ?? "", timeframe: timeframe ?? "" };

    if (isHtmx) {
      res.render("events/partials/event-list", {
        events,
        pageError: error,
        layout: false,
      });
      return;
    }

    res.render("events/list", {
      session,
      pageError: error,
      events,
      filters: filterState,
    });
  }
}

export function CreateEventController(service: IEventService, logger: ILoggingService): IEventController {
  return new EventController(service, logger);
}