import { integer, object, optionalText, optionalTimestamp, text, timestamp } from "./validation.js";

export const RUN_STATES = [
  "created",
  "running",
  "waiting_approval",
  "stopping",
  "technical_complete",
  "failed",
  "cancelled",
  "needs_confirmation",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/**
 * Non-terminal states that reserve the workspace's single active-run slot.
 * `needs_confirmation` remains active so an unknown outcome cannot be bypassed
 * by starting another Run.
 */
export const ACTIVE_RUN_STATES = [
  "created",
  "running",
  "waiting_approval",
  "stopping",
  "needs_confirmation",
] as const satisfies readonly RunState[];
export type ActiveRunState = (typeof ACTIVE_RUN_STATES)[number];

export const TERMINAL_RUN_STATES = [
  "technical_complete",
  "failed",
  "cancelled",
] as const satisfies readonly RunState[];
export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

export interface Run {
  id: string;
  workspaceId: string;
  conversationId: string;
  sequence: number;
  state: RunState;
  operatorEpoch: number;
  runnerId: string;
  contextSnapshotId: string;
  startedBy: string;
  startedAt: string;
  endedAt?: string | undefined;
  /** SessionCheckpoint id; the checkpoint must belong to `conversationId`. */
  lastKnownCheckpoint?: string | undefined;
}

/**
 * Run carries technical execution state only. The operator's business result
 * is a separate manual CompletionAssessment and is never a Run field.
 */
export function parseRun(value: unknown): Run {
  const input = object(value, "Run");
  const state = text(input.state, "Run.state");
  if (!RUN_STATES.includes(state as RunState)) {
    throw new TypeError(`Unsupported Run.state: ${state}`);
  }
  return {
    id: text(input.id, "Run.id"),
    workspaceId: text(input.workspaceId, "Run.workspaceId"),
    conversationId: text(input.conversationId, "Run.conversationId"),
    sequence: integer(input.sequence, "Run.sequence", 1),
    state: state as RunState,
    operatorEpoch: integer(input.operatorEpoch, "Run.operatorEpoch", 1),
    runnerId: text(input.runnerId, "Run.runnerId"),
    contextSnapshotId: text(input.contextSnapshotId, "Run.contextSnapshotId"),
    startedBy: text(input.startedBy, "Run.startedBy"),
    startedAt: timestamp(input.startedAt, "Run.startedAt"),
    endedAt: optionalTimestamp(input.endedAt, "Run.endedAt"),
    lastKnownCheckpoint: optionalText(input.lastKnownCheckpoint, "Run.lastKnownCheckpoint"),
  };
}
