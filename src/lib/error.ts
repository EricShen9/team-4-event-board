// src/errors/EventError.ts

export type EventError =
  | { name: "EventNotFound"; message: string }
  | { name: "EventAlreadyExists"; message: string }
  | { name: "EventIdMismatch"; message: string }
  | { name: "EventValidationError"; message: string }  // Covers invalid data, date range, capacity
  | { name: "EventAuthorizationError"; message: string }
  | { name: "EventStateError"; message: string };  // Covers already published/cancelled

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