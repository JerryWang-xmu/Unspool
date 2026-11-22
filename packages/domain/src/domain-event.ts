import type { JsonObject } from "./validation.js";
import { integer, object, optionalText, text, timestamp } from "./validation.js";

export interface DomainEvent {
  id: string;
  workspaceId: string;
  sequence: number;
  schemaVersion: number;
  type: string;
  actorId?: string | undefined;
  runId?: string | undefined;
  occurredAt: string;
  visibility: JsonObject;
  payloadRef: string;
  payloadDigest: string;
}

export function parseDomainEvent(value: unknown): DomainEvent {
  const input = object(value, "DomainEvent");
  return {
    id: text(input.id, "DomainEvent.id"),
    workspaceId: text(input.workspaceId, "DomainEvent.workspaceId"),
    sequence: integer(input.sequence, "DomainEvent.sequence", 1),
    schemaVersion: integer(input.schemaVersion, "DomainEvent.schemaVersion", 1),
    type: text(input.type, "DomainEvent.type"),
    actorId: optionalText(input.actorId, "DomainEvent.actorId"),
    runId: optionalText(input.runId, "DomainEvent.runId"),
    occurredAt: timestamp(input.occurredAt, "DomainEvent.occurredAt"),
    visibility: object(input.visibility, "DomainEvent.visibility"),
    payloadRef: text(input.payloadRef, "DomainEvent.payloadRef"),
    payloadDigest: text(input.payloadDigest, "DomainEvent.payloadDigest"),
  };
}
