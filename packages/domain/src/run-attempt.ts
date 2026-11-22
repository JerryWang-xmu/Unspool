import { integer, object, optionalText, optionalTimestamp, text, timestamp } from "./validation.js";

export const RUN_ATTEMPT_STATES = [
  "assigned",
  "dispatched",
  "running",
  "settled",
  "outcome_unknown",
] as const;
export type RunAttemptState = (typeof RUN_ATTEMPT_STATES)[number];

export interface RunAttempt {
  id: string;
  runId: string;
  workerId: string;
  attemptEpoch: number;
  state: RunAttemptState;
  leaseExpiresAt: string;
  startedAt: string;
  settledAt?: string | undefined;
  unknownReason?: string | undefined;
}

/**
 * `attemptEpoch` is part of the execution fence with `id`; heartbeats, events
 * and results from an older epoch are rejected. A dispatched attempt without a
 * definite result becomes `outcome_unknown` and is never automatically replaced.
 */
export function parseRunAttempt(value: unknown): RunAttempt {
  const input = object(value, "RunAttempt");
  const state = text(input.state, "RunAttempt.state");
  if (!RUN_ATTEMPT_STATES.includes(state as RunAttemptState)) {
    throw new TypeError(`Unsupported RunAttempt.state: ${state}`);
  }
  return {
    id: text(input.id, "RunAttempt.id"),
    runId: text(input.runId, "RunAttempt.runId"),
    workerId: text(input.workerId, "RunAttempt.workerId"),
    attemptEpoch: integer(input.attemptEpoch, "RunAttempt.attemptEpoch", 1),
    state: state as RunAttemptState,
    leaseExpiresAt: timestamp(input.leaseExpiresAt, "RunAttempt.leaseExpiresAt"),
    startedAt: timestamp(input.startedAt, "RunAttempt.startedAt"),
    settledAt: optionalTimestamp(input.settledAt, "RunAttempt.settledAt"),
    unknownReason: optionalText(input.unknownReason, "RunAttempt.unknownReason"),
  };
}
