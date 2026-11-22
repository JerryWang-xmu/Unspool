import { integer, object, optionalTimestamp, text } from "./validation.js";

export const QUEUED_INSTRUCTION_KINDS = ["steer", "follow_up"] as const;
export type QueuedInstructionKind = (typeof QUEUED_INSTRUCTION_KINDS)[number];

export const QUEUED_INSTRUCTION_STATES = [
  "queued",
  "withheld",
  "modified",
  "deleted",
  "released",
] as const;
export type QueuedInstructionState = (typeof QUEUED_INSTRUCTION_STATES)[number];

export interface QueuedInstruction {
  id: string;
  runId: string;
  sourceCommandId: string;
  kind: QueuedInstructionKind;
  body: string;
  state: QueuedInstructionState;
  position: number;
  dequeuedAt?: string | undefined;
  persistedAt?: string | undefined;
}

/**
 * Unspool owns instruction identity and FIFO order through `id`, `position` and
 * `sourceCommandId`; duplicate body text is not a correlation key. A stop moves
 * rows to `withheld`, and pi queue restoration must never re-enqueue them.
 */
export function parseQueuedInstruction(value: unknown): QueuedInstruction {
  const input = object(value, "QueuedInstruction");
  const kind = text(input.kind, "QueuedInstruction.kind");
  if (!QUEUED_INSTRUCTION_KINDS.includes(kind as QueuedInstructionKind)) {
    throw new TypeError(`Unsupported QueuedInstruction.kind: ${kind}`);
  }
  const state = text(input.state, "QueuedInstruction.state");
  if (!QUEUED_INSTRUCTION_STATES.includes(state as QueuedInstructionState)) {
    throw new TypeError(`Unsupported QueuedInstruction.state: ${state}`);
  }
  const dequeuedAt = optionalTimestamp(input.dequeuedAt, "QueuedInstruction.dequeuedAt");
  const persistedAt = optionalTimestamp(input.persistedAt, "QueuedInstruction.persistedAt");
  if (persistedAt !== undefined && dequeuedAt === undefined) {
    throw new TypeError("QueuedInstruction.persistedAt requires dequeuedAt");
  }
  return {
    id: text(input.id, "QueuedInstruction.id"),
    runId: text(input.runId, "QueuedInstruction.runId"),
    sourceCommandId: text(input.sourceCommandId, "QueuedInstruction.sourceCommandId"),
    kind: kind as QueuedInstructionKind,
    body: text(input.body, "QueuedInstruction.body"),
    state: state as QueuedInstructionState,
    position: integer(input.position, "QueuedInstruction.position", 1),
    dequeuedAt,
    persistedAt,
  };
}
