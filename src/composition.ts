import { CreateAdminUserService } from "./auth/AdminUserService";
import { CreateAuthController } from "./auth/AuthController";
import { CreateAuthService } from "./auth/AuthService";
import { CreateInMemoryUserRepository } from "./auth/InMemoryUserRepository";
import { CreatePasswordHasher } from "./auth/PasswordHasher";
import { CreateApp } from "./app";
import type { IApp } from "./contracts";
import { CreateLoggingService } from "./service/LoggingService";
import type { ILoggingService } from "./service/LoggingService";
import { CreateInMemoryEventRepository } from "./repository/InMemoryEventRepository";
import { CreateEventService } from "./service/EventService";
import { CreateEventController } from "./controller/EventController";
import { CreateInMemoryRSVPRepository } from "./repository/InMemoryRSVPRepository";
import { CreateRSVPService } from "./service/RSVPService";
import { CreateRSVPController } from "./controller/RSVPController";
import { CreatePrismaEventRepository } from "./repository/PrismaEventRepository";

export function createComposedApp(logger?: ILoggingService): IApp {
  const resolvedLogger = logger ?? CreateLoggingService();

  // Authentication & authorization wiring
  const authUsers = CreateInMemoryUserRepository();
  const passwordHasher = CreatePasswordHasher();
  const authService = CreateAuthService(authUsers, passwordHasher);
  const adminUserService = CreateAdminUserService(authUsers, passwordHasher);
  const authController = CreateAuthController(authService, adminUserService, resolvedLogger);
  // Event wiring
  const eventRepository = CreatePrismaEventRepository(resolvedLogger);
  const eventService = CreateEventService(eventRepository, resolvedLogger);
  const eventController = CreateEventController(eventService, resolvedLogger);

  // RSVP Wiring
  const rsvpRepository = CreateInMemoryRSVPRepository(resolvedLogger);
  const rsvpService = CreateRSVPService(rsvpRepository, eventRepository, resolvedLogger);
  const rsvpController = CreateRSVPController(rsvpService, resolvedLogger);

  return CreateApp(authController, eventController, rsvpController, resolvedLogger);

}
