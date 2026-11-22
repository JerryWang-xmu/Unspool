import { object, text, textArray, timestamp } from "../../domain/src/validation.js";

export interface Attribution {
  actorId: string;
  displayNameAtTime: string;
  rolesAtTime: string[];
  occurredAt: string;
}

export function parseAttribution(value: unknown): Attribution {
  const input = object(value, "Attribution");
  return {
    actorId: text(input.actorId, "Attribution.actorId"),
    displayNameAtTime: text(input.displayNameAtTime, "Attribution.displayNameAtTime"),
    rolesAtTime: textArray(input.rolesAtTime, "Attribution.rolesAtTime"),
    occurredAt: timestamp(input.occurredAt, "Attribution.occurredAt"),
  };
}
