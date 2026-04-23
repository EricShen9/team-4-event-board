export type EventError =
  | { name: "EventNotFound"; message: string }
  | { name: "EventAlreadyExists"; message: string }
  | { name: "EventIdMismatch"; message: string }
  | { name: "EventValidationError"; message: string }
  | { name: "EventAuthorizationError"; message: string }
  | { name: "EventStateError"; message: string };

export const EventNotFound = (message: string): EventError => ({
  name: "EventNotFound",
  message,
});

export const EventAlreadyExists = (message: string): EventError => ({
  name: "EventAlreadyExists",
  message,
});

export const EventIdMismatch = (message: string): EventError => ({
  name: "EventIdMismatch",
  message,
});

export const EventValidationError = (message: string): EventError => ({
  name: "EventValidationError",
  message,
});

export const EventAuthorizationError = (message: string): EventError => ({
  name: "EventAuthorizationError",
  message,
});

export const EventStateError = (message: string): EventError => ({
  name: "EventStateError",
  message,
});

export type RSVPError =
  | { name: "RSVPNotFound"; message: string }
  | { name: "RSVPAuthorizationError"; message: string }
  | { name: "RSVPStateError"; message: string };

export const RSVPNotFound = (message: string): RSVPError => ({
  name: "RSVPNotFound",
  message,
});

export const RSVPAuthorizationError = (message: string): RSVPError => ({
  name: "RSVPAuthorizationError",
  message,
});

export const RSVPStateError = (message: string): RSVPError => ({
  name: "RSVPStateError",
  message,
});

export type SearchError =
  | { name: "SearchValidationError"; message: string };

export const SearchValidationError = (message: string): SearchError => ({
  name: "SearchValidationError",
  message,
});