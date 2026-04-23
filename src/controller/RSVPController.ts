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

    if (result.ok === false) {
      this.logger.warn(`RSVP toggle failed: ${result.value.message}`);
      res.status(400).render("partials/error", {
        message: result.value.message,
        layout: false,
      });
      return;
    }

    const isHtmxRequest = req.get("HX-Request") === "true";
    const referer = req.get("Referer") ?? "";

    if (isHtmxRequest && referer.includes("/my-rsvps")) {
      const session = touchAppSession(store);
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

      res.status(200).render("rsvps/dashboard", {
        session,
        dashboard: dashboardResult.value,
        layout: false,
      });
      return;
    }

    if (referer.includes(`/events/${eventId}`)) {
      res.redirect(`/events/${eventId}`);
      return;
    }

    if (referer.includes("/my-rsvps")) {
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