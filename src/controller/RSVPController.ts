import type { Request, Response } from "express";
import {
  getAuthenticatedUser,
  touchAppSession,
  type AppSessionStore,
} from "../session/AppSession";
import type { ILoggingService } from "../service/LoggingService";
import type { IRSVPService } from "../service/RSVPService";

export interface IRSVPController {
  getMyRSVPDashboardFromRequest(
    res: Response,
    store: AppSessionStore,
  ): Promise<void>;

  showRSVPControls(
    res: Response,
    eventId: string,
    store: AppSessionStore,
  ): Promise<void>;

  toggleRSVPFromRequest(
    req: Request,
    res: Response,
    eventId: string,
    store: AppSessionStore,
  ): Promise<void>;
}

class RSVPController implements IRSVPController {
  constructor(
    private readonly rsvpService: IRSVPService,
    private readonly logger: ILoggingService,
  ) {}
  private mapToggleErrorStatus(error: Error): number {
    if (error.name === "RSVPAuthorizationError") return 403;
    if (error.name === "RSVPNotFound") return 404;
    if (error.name === "RSVPStateError") return 409;
    return 400;
  }

  private async renderDetailRSVPControls(
    res: Response,
    eventId: string,
    store: AppSessionStore,
    actionError: string | null = null,
    actionSuccess: string | null = null,
  ): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    if (!currentUser) {
      res.status(401).render("partials/error", {
        message: "Unauthorized",
        layout: false,
      });
      return;
    }

    const stateResult = await this.rsvpService.getRSVPDetailState(
      eventId,
      currentUser.userId,
      currentUser.role,
    );

    if (stateResult.ok === false) {
      this.logger.warn(`RSVP controls load failed: ${stateResult.value.message}`);
      res.status(400).render("partials/error", {
        message: stateResult.value.message,
        layout: false,
      });
      return;
    }

    res.status(200).render("events/partials/rsvp-controls", {
      session,
      state: stateResult.value,
      actionError,
      actionSuccess,
      layout: false,
    });
  }

  async showRSVPControls(
    res: Response,
    eventId: string,
    store: AppSessionStore,
  ): Promise<void> {
    await this.renderDetailRSVPControls(res, eventId, store);
  }

  async toggleRSVPFromRequest(
    req: Request,
    res: Response,
    eventId: string,
    store: AppSessionStore,
  ): Promise<void> {
    const currentUser = getAuthenticatedUser(store);

    if (!currentUser) {
      res.status(401).render("partials/error", {
        message: "Unauthorized",
        layout: false,
      });
      return;
    }

    const result = await this.rsvpService.toggleRSVP(
      eventId,
      currentUser.userId,
      currentUser.role,
    );

    const isHtmxRequest = req.get("HX-Request") === "true";
    const referer = req.get("Referer") ?? "";
    const fromDetailPage = referer.includes(`/events/${eventId}`);
    const fromDashboard = referer.includes("/my-rsvps");

    if (result.ok === false) {
  const status = this.mapToggleErrorStatus(result.value);
  this.logger.warn(`RSVP toggle failed: ${result.value.message}`);

  if (isHtmxRequest && fromDetailPage) {
    await this.renderDetailRSVPControls(
      res,
      eventId,
      store,
      result.value.message,
      null,
    );
    return;
  }

  res.status(status).render("partials/error", {
    message: result.value.message,
    layout: false,
  });
  return;
}

    if (isHtmxRequest && fromDashboard) {
      const dashboardResult = await this.rsvpService.getMyRSVPDashboard(
        currentUser.userId,
        currentUser.role,
      );

      if (dashboardResult.ok === false) {
        this.logger.warn(
          `RSVP dashboard refresh failed: ${dashboardResult.value.message}`,
        );
        res.status(400).render("partials/error", {
          message: dashboardResult.value.message,
          layout: false,
        });
        return;
      }

      const cancelledRsvpId = result.value.id;

      res.status(200).render("rsvps/dashboard-cancel-response", {
        cancelledRsvpId,
        dashboard: dashboardResult.value,
        layout: false,
      });
      return;
    }

    if (isHtmxRequest && fromDetailPage) {
      await this.renderDetailRSVPControls(
        res,
        eventId,
        store,
        null,
        "RSVP updated.",
      );
      return;
    }

    if (fromDetailPage) {
      res.redirect(`/events/${eventId}`);
      return;
    }

    if (fromDashboard) {
      res.redirect("/my-rsvps");
      return;
    }

    res.redirect("/home");
  }

  async getMyRSVPDashboardFromRequest(
    res: Response,
    store: AppSessionStore,
  ): Promise<void> {
    const session = touchAppSession(store);
    const currentUser = getAuthenticatedUser(store);

    if (!currentUser) {
      this.logger.warn("RSVP dashboard access denied: unauthenticated user.");
      res.status(401).render("partials/error", {
        message: "Unauthorized",
        layout: false,
      });
      return;
    }

    const result = await this.rsvpService.getMyRSVPDashboard(
      currentUser.userId,
      currentUser.role,
    );

    if (result.ok === false) {
      this.logger.warn(`RSVP dashboard load failed: ${result.value.message}`);
      res.status(403).render("partials/error", {
        message: result.value.message,
        layout: false,
      });
      return;
    }

    res.status(200).render("rsvps/dashboard", {
      session,
      dashboard: result.value,
    });
  }
}

export function CreateRSVPController(
  rsvpService: IRSVPService,
  logger: ILoggingService,
): IRSVPController {
  return new RSVPController(rsvpService, logger);
}