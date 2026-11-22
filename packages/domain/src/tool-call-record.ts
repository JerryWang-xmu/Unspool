import { object, optionalText, text, timestamp } from "./validation.js";

export const TOOL_CALL_STATES = [
  "preflight",
  "waiting_approval",
  "dispatched",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "outcome_unknown",
] as const;
export type ToolCallState = (typeof TOOL_CALL_STATES)[number];

export interface ToolCallRecord {
  id: string;
  runAttemptId: string;
  toolCallId: string;
  parentToolCallId?: string | undefined;
  toolName: string;
  originalArgsDigest: string;
  effectiveArgsDigest: string;
  state: ToolCallState;
  preflightAt: string;
  executionEnteredAt?: string | undefined;
  finalizedAt?: string | undefined;
  resultDigest?: string | undefined;
  transcriptEntryId?: string | undefined;
}

const FINAL_STATES: readonly ToolCallState[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "outcome_unknown",
];

export function parseToolCallRecord(value: unknown): ToolCallRecord {
  const input = object(value, "ToolCallRecord");
  const state = text(input.state, "ToolCallRecord.state") as ToolCallState;
  if (!TOOL_CALL_STATES.includes(state))
    throw new TypeError(`Unsupported ToolCallRecord.state: ${state}`);
  const executionEnteredAt =
    input.executionEnteredAt === undefined
      ? undefined
      : timestamp(input.executionEnteredAt, "ToolCallRecord.executionEnteredAt");
  const finalizedAt =
    input.finalizedAt === undefined
      ? undefined
      : timestamp(input.finalizedAt, "ToolCallRecord.finalizedAt");
  if (state !== "preflight" && state !== "waiting_approval" && executionEnteredAt === undefined) {
    throw new TypeError(`ToolCallRecord ${state} requires executionEnteredAt`);
  }
  if (
    ["succeeded", "failed", "cancelled", "timed_out"].includes(state) &&
    finalizedAt === undefined
  ) {
    throw new TypeError(`ToolCallRecord ${state} requires finalizedAt`);
  }
  if (!FINAL_STATES.includes(state) && finalizedAt !== undefined) {
    throw new TypeError(`ToolCallRecord ${state} cannot have finalizedAt`);
  }
  return {
    id: text(input.id, "ToolCallRecord.id"),
    runAttemptId: text(input.runAttemptId, "ToolCallRecord.runAttemptId"),
    toolCallId: text(input.toolCallId, "ToolCallRecord.toolCallId"),
    parentToolCallId: optionalText(input.parentToolCallId, "ToolCallRecord.parentToolCallId"),
    toolName: text(input.toolName, "ToolCallRecord.toolName"),
    originalArgsDigest: text(input.originalArgsDigest, "ToolCallRecord.originalArgsDigest"),
    effectiveArgsDigest: text(input.effectiveArgsDigest, "ToolCallRecord.effectiveArgsDigest"),
    state,
    preflightAt: timestamp(input.preflightAt, "ToolCallRecord.preflightAt"),
    executionEnteredAt,
    finalizedAt,
    resultDigest: optionalText(input.resultDigest, "ToolCallRecord.resultDigest"),
    transcriptEntryId: optionalText(input.transcriptEntryId, "ToolCallRecord.transcriptEntryId"),
  };
}

export function assertToolCallNesting(records: readonly ToolCallRecord[]): void {
  const ids = new Set(records.map((record) => record.toolCallId));
  for (const record of records) {
    if (record.parentToolCallId === record.toolCallId)
      throw new TypeError(`Tool call ${record.toolCallId} cannot parent itself`);
    if (record.parentToolCallId !== undefined && !ids.has(record.parentToolCallId)) {
      throw new TypeError(`Missing parent tool call ${record.parentToolCallId}`);
    }
  }
  for (const record of records) {
    const seen = new Set<string>();
    let current: string | undefined = record.toolCallId;
    while (current !== undefined) {
      if (seen.has(current)) throw new TypeError(`Tool call parent cycle detected at ${current}`);
      seen.add(current);
      current = records.find((candidate) => candidate.toolCallId === current)?.parentToolCallId;
    }
  }
}
