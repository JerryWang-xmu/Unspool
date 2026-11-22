import { object, optionalText, text, timestamp } from "./validation.js";

export interface SessionCheckpoint {
  id: string;
  conversationId: string;
  runId?: string | undefined;
  piLeafId: string;
  lastPersistedEntryId: string;
  lastProjectedEventId: string;
  createdAt: string;
}

/**
 * A checkpoint advances only after pi has persisted the entry and Unspool has
 * drained and reconciled its own projection. A `message_end` notification
 * alone is not sufficient.
 */
export function parseSessionCheckpoint(value: unknown): SessionCheckpoint {
  const input = object(value, "SessionCheckpoint");
  return {
    id: text(input.id, "SessionCheckpoint.id"),
    conversationId: text(input.conversationId, "SessionCheckpoint.conversationId"),
    runId: optionalText(input.runId, "SessionCheckpoint.runId"),
    piLeafId: text(input.piLeafId, "SessionCheckpoint.piLeafId"),
    lastPersistedEntryId: text(
      input.lastPersistedEntryId,
      "SessionCheckpoint.lastPersistedEntryId",
    ),
    lastProjectedEventId: text(
      input.lastProjectedEventId,
      "SessionCheckpoint.lastProjectedEventId",
    ),
    createdAt: timestamp(input.createdAt, "SessionCheckpoint.createdAt"),
  };
}
