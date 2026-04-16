import path from "node:path";
import express, { Request, RequestHandler, Response } from "express";
import session from "express-session";
import Layouts from "express-ejs-layouts";
import { IAuthController } from "./auth/AuthController";
import {
  AuthenticationRequired,
  AuthorizationRequired,
} from "./auth/errors";
import type { UserRole } from "./auth/User";
import { IApp } from "./contracts";
import {
  getAuthenticatedUser,
  isAuthenticatedSession,
  AppSessionStore,
  recordPageView,
  touchAppSession,
} from "./session/AppSession";
import { ILoggingService } from "./service/LoggingService";
import type { IEventController } from "./controller/EventController";

type AsyncRequestHandler = RequestHandler;

function asyncHandler(fn: AsyncRequestHandler) {
  return function wrapped(req: Request, res: Response, next: (value?: unknown) => void) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function sessionStore(req: Request): AppSessionStore {
  return req.session as AppSessionStore;
}

class ExpressApp implements IApp {
  private readonly app: express.Express;

  constructor(
    private readonly authController: IAuthController,
    private readonly eventController: IEventController,
    private readonly logger: ILoggingService,
  ) {
    this.app = express();
    this.registerMiddleware();
    this.registerTemplating();
    this.registerRoutes();
  }

  private registerMiddleware(): void {
    // Serve static files from src/static (create this directory to add your own assets)
    this.app.use(express.static(path.join(process.cwd(), "src/static")));
    this.app.use(
      session({
        name: "app.sid",
        secret: process.env.SESSION_SECRET ?? "project-starter-demo-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: "lax",
        },
      }),
    );
    this.app.use(Layouts);
    this.app.use(express.urlencoded({ extended: true }));
  }

  private registerTemplating(): void {
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(process.cwd(), "src/views"));
    this.app.set("layout", "layouts/base");
  }

  private isHtmxRequest(req: Request): boolean {
    return req.get("HX-Request") === "true";
  }

  /**
   * Middleware helper: returns true if the request is from an authenticated user.
   * If the user is not authenticated, it handles the response (redirect or 401).
   */
  private requireAuthenticated(req: Request, res: Response): boolean {
    const store = sessionStore(req);
    touchAppSession(store);

    if (getAuthenticatedUser(store)) {
      return true;
    }

    this.logger.warn("Blocked unauthenticated request to a protected route");
    if (this.isHtmxRequest(req) || req.method !== "GET") {
      res.status(401).render("partials/error", {
        message: AuthenticationRequired("Please log in to continue.").message,
        layout: false,
      });
      return false;
    }

    res.redirect("/login");
    return false;
  }

  /**
   * Middleware helper: returns true if the authenticated user has one of the
   * allowed roles. Calls requireAuthenticated first, so unauthenticated
   * requests are handled automatically.
   */
  private requireRole(
    req: Request,
    res: Response,
    allowedRoles: UserRole[],
    message: string,
  ): boolean {
    if (!this.requireAuthenticated(req, res)) {
      return false;
    }

    const currentUser = getAuthenticatedUser(sessionStore(req));
    if (currentUser && allowedRoles.includes(currentUser.role)) {
      return true;
    }

    this.logger.warn(
      `Blocked unauthorized request for role ${currentUser?.role ?? "unknown"}`,
    );
    res.status(403).render("partials/error", {
      message: AuthorizationRequired(message).message,
      layout: false,
    });
    return false;
  }  

  private registerRoutes(): void {
    // ── Public routes ────────────────────────────────────────────────

    this.app.get(
      "/",
      asyncHandler(async (req, res) => {
        this.logger.info("GET /");
        const store = sessionStore(req);
        res.redirect(isAuthenticatedSession(store) ? "/home" : "/login");
      }),
    );

    this.app.get(
      "/login",
      asyncHandler(async (req, res) => {
        const store = sessionStore(req);
        const browserSession = recordPageView(store);

        if (getAuthenticatedUser(store)) {
          res.redirect("/home");
          return;
        }

        await this.authController.showLogin(res, browserSession);
      }),
    );

    this.app.post(
      "/login",
      asyncHandler(async (req, res) => {
        const email = typeof req.body.email === "string" ? req.body.email : "";
        const password = typeof req.body.password === "string" ? req.body.password : "";
        await this.authController.loginFromForm(res, email, password, sessionStore(req));
      }),
    );

    this.app.post(
      "/logout",
      asyncHandler(async (req, res) => {
        await this.authController.logoutFromForm(res, sessionStore(req));
      }),
    );

    // ── Event creation routes ─────────────────────────────────────────

    // Show the "create event" form (staff + admin only)
    this.app.get(
      "/events/new",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can create events.",
          )
        ) {
          return;
        }

        const store = sessionStore(req);
        const browserSession = recordPageView(store);
        this.logger.info(`GET /events/new for ${browserSession.browserLabel}`);

        await this.eventController.showCreateEventForm(res, browserSession);
      }),
    );

    // Handle event creation form submission (staff + admin only)
    this.app.post(
      "/events",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can create events.",
          )
        ) {
          return;
        }

        const store = sessionStore(req);
        this.logger.info(`POST /events by ${getAuthenticatedUser(store)?.userId ?? "unknown"}`);

        await this.eventController.createEventFromForm(res, req.body, store);
      }),
    );

    // Show the "edit event" form (staff + admin only)
    this.app.get(
      "/events/:id/edit",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can modify events.",
          )
        ) {
          return;
        }

        const eventId = typeof req.params.id === "string" ? req.params.id : "";
        const store = sessionStore(req);
        const browserSession = recordPageView(store);
        this.logger.info(`GET /events/${eventId}/edit for ${browserSession.browserLabel}`);

        await this.eventController.showEditEventForm(res, eventId, browserSession);
      }),
    );

    // Handle event modification form submission (staff + admin only)
    this.app.post(
      "/events/:id",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can modify events.",
          )
        ) {
          return;
        }

        const eventId = typeof req.params.id === "string" ? req.params.id : "";
        const store = sessionStore(req);
        this.logger.info(
          `POST /events/${eventId} by ${getAuthenticatedUser(store)?.userId ?? "unknown"}`,
        );

        await this.eventController.modifyEventFromForm(res, eventId, req.body, store);
      }),
    );

      // ── Event search route ───────────────────────────────────────────

    this.app.get(
      "/events/search",
      asyncHandler(async (req, res) => {
        if (!this.requireAuthenticated(req, res)) {
          return;
        }

        const query = typeof req.query.q === "string" ? req.query.q : "";
        const store = sessionStore(req);
        const browserSession = recordPageView(store);
        this.logger.info(`GET /events/search?q=${query}`);

        await this.eventController.showSearchPage(res, browserSession, query);
      }),
    );
    


    // ── Event lifecycle routes (publish / cancel) ─────────────────────

    // Publish a draft event (staff + admin, but service enforces ownership)
    this.app.post(
      "/events/:id/publish",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can publish events.",
          )
        ) {
          return;
        }

        const eventId = typeof req.params.id === "string" ? req.params.id : "";
        const store = sessionStore(req);
        this.logger.info(
          `POST /events/${eventId}/publish by ${getAuthenticatedUser(store)?.userId ?? "unknown"}`,
        );

        await this.eventController.publishEvent(res, eventId, store);
      }),
    );

    // Cancel a published event (staff + admin, but service enforces ownership / admin override)
    this.app.post(
      "/events/:id/cancel",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can cancel events.",
          )
        ) {
          return;
        }

        const eventId = typeof req.params.id === "string" ? req.params.id : "";
        const store = sessionStore(req);
        this.logger.info(
          `POST /events/${eventId}/cancel by ${getAuthenticatedUser(store)?.userId ?? "unknown"}`,
        );

        await this.eventController.cancelEvent(res, eventId, store);
      }),
    );

    // Show the organizer dashboard (staff + admin only; members rejected at route level)
    this.app.get(
      "/organizer-dashboard",
      asyncHandler(async (req, res) => {
        if (
          !this.requireRole(
            req,
            res,
            ["staff", "admin"],
            "Only Staff or Admin can access the organizer dashboard.",
          )
        ) {
          return;
        }

        const store = sessionStore(req);
        this.logger.info(
          `GET /organizer-dashboard by ${getAuthenticatedUser(store)?.userId ?? "unknown"}`,
        );

        await this.eventController.showOrganizerDashboard(res, store);
      }),
    );

    // ── Admin routes ─────────────────────────────────────────────────

    this.app.get(
      "/admin/users",
      asyncHandler(async (req, res) => {
        if (!this.requireRole(req, res, ["admin"], "Only Admin can manage users.")) {
          return;
        }

        const browserSession = recordPageView(sessionStore(req));
        await this.authController.showAdminUsers(res, browserSession);
      }),
    );

    this.app.post(
      "/admin/users",
      asyncHandler(async (req, res) => {
        if (!this.requireRole(req, res, ["admin"], "Only Admin can manage users.")) {
          return;
        }

        const roleValue = typeof req.body.role === "string" ? req.body.role : "user";
        const role: UserRole =
          roleValue === "admin" || roleValue === "staff" || roleValue === "user"
            ? roleValue
            : "user";

        await this.authController.createUserFromForm(
          res,
          {
            email: typeof req.body.email === "string" ? req.body.email : "",
            displayName:
              typeof req.body.displayName === "string" ? req.body.displayName : "",
            password: typeof req.body.password === "string" ? req.body.password : "",
            role,
          },
          touchAppSession(sessionStore(req)),
        );
      }),
    );

    this.app.post(
      "/admin/users/:id/delete",
      asyncHandler(async (req, res) => {
        if (!this.requireRole(req, res, ["admin"], "Only Admin can manage users.")) {
          return;
        }

        const session = touchAppSession(sessionStore(req));
        const currentUser = getAuthenticatedUser(sessionStore(req));
        if (!currentUser) {
          res.status(401).render("partials/error", {
            message: AuthenticationRequired("Please log in to continue.").message,
            layout: false,
          });
          return;
        }

        await this.authController.deleteUserFromForm(
          res,
          typeof req.params.id === "string" ? req.params.id : "",
          currentUser.userId,
          session,
        );
      }),
    );

    // ── Authenticated home page ──────────────────────────────────────
    // TODO: Replace this placeholder with your project's main page.

    this.app.get(
      "/home",
      asyncHandler(async (req, res) => {
        if (!this.requireAuthenticated(req, res)) {
          return;
        }

        const browserSession = recordPageView(sessionStore(req));
        this.logger.info(`GET /home for ${browserSession.browserLabel}`);
        res.render("home", { session: browserSession, pageError: null });
      }),
    );

    //Features 2 and 6 event routes
    this.app.get(
      "/events",
      asyncHandler(async (req, res) => {
        if (!this.requireAuthenticated(req, res)) return;

        const category = 
          typeof req.query.category === "string" ? req.query.category : undefined;
        const timeframe =
          typeof req.query.timeframe === "string" ? req.query.timeframe : undefined;

        await this.eventController.showEventList(
          res,
          sessionStore(req),
          category,
          timeframe,
        );
      }),
    );

    this.app.get(
      "/events/:id",
      asyncHandler(async (req, res) => {
        if (!this.requireAuthenticated(req, res)) return;

        const eventId = typeof req.params.id === "string" ? req.params.id : "";
        await this.eventController.showEventDetail(res, eventId, sessionStore(req));
      }),
    );

    // ── Error handler ────────────────────────────────────────────────

    this.app.use((err: unknown, _req: Request, res: Response, _next: (value?: unknown) => void) => {
      const message = err instanceof Error ? err.message : "Unexpected server error.";
      this.logger.error(message);
      res.status(500).render("partials/error", {
        message: "Unexpected server error.",
        layout: false,
      });
    });
  }

  getExpressApp(): express.Express {
    return this.app;
  }
}

export function CreateApp(
  authController: IAuthController,
  eventController: IEventController,
  logger: ILoggingService,
): IApp {
  return new ExpressApp(authController, eventController, logger);
}