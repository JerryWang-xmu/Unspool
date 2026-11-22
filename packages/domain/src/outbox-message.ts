import { integer, object, text, timestamp } from "./validation.js";

export const OUTBOX_STATES = ["pending", "dispatched", "failed", "dead"] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

export interface OutboxMessage {
  id: string;
  domainEventId: string;
  destination: string;
  state: OutboxState;
  attemptCount: number;
  availableAt: string;
}

export function parseOutboxMessage(value: unknown): OutboxMessage {
  const input = object(value, "OutboxMessage");
  const state = text(input.state, "OutboxMessage.state");
  if (!OUTBOX_STATES.includes(state as OutboxState)) {
    throw new TypeError(`Unsupported OutboxMessage.state: ${state}`);
  }
  return {
    id: text(input.id, "OutboxMessage.id"),
    domainEventId: text(input.domainEventId, "OutboxMessage.domainEventId"),
    destination: text(input.destination, "OutboxMessage.destination"),
    state: state as OutboxState,
    attemptCount: integer(input.attemptCount, "OutboxMessage.attemptCount"),
    availableAt: timestamp(input.availableAt, "OutboxMessage.availableAt"),
  };
}
