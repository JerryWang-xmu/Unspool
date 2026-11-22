import { integer, object, optionalTimestamp, text, timestamp } from "./validation.js";

export const USER_STATES = ["active", "disabled"] as const;
export type UserState = (typeof USER_STATES)[number];

export interface User {
  id: string;
  displayName: string;
  status: UserState;
  authVersion: number;
  createdAt: string;
  disabledAt?: string | undefined;
}

export function parseUser(value: unknown): User {
  const input = object(value, "User");
  const status = text(input.status, "User.status");
  if (!USER_STATES.includes(status as UserState))
    throw new TypeError(`Unsupported User.status: ${status}`);
  const disabledAt = optionalTimestamp(input.disabledAt, "User.disabledAt");
  if (status === "disabled" && !disabledAt)
    throw new TypeError("disabled users require disabledAt");
  if (status === "active" && disabledAt) throw new TypeError("active users cannot have disabledAt");
  return {
    id: text(input.id, "User.id"),
    displayName: text(input.displayName, "User.displayName"),
    status: status as UserState,
    authVersion: integer(input.authVersion, "User.authVersion", 1),
    createdAt: timestamp(input.createdAt, "User.createdAt"),
    disabledAt,
  };
}
