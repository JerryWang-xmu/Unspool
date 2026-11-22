import { RUN_STATES, type RunState } from "./run.js";
import { integer, object, text, textArray } from "./validation.js";

export interface HandoffSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly goal: string;
  readonly criteria: string;
  readonly runState: RunState;
  readonly decisions: readonly string[];
  readonly completedWork: readonly string[];
  readonly pendingApprovalIds: readonly string[];
  readonly queueIds: readonly string[];
  readonly todoIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly blockers: readonly string[];
  readonly grantIds: readonly string[];
}

export interface CreateHandoffSummaryInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly goal: string;
  readonly criteria: string;
  readonly runState: RunState;
  readonly decisions?: readonly string[] | undefined;
  readonly completedWork?: readonly string[] | undefined;
  readonly pendingApprovalIds?: readonly string[] | undefined;
  readonly queueIds?: readonly string[] | undefined;
  readonly todoIds?: readonly string[] | undefined;
  readonly artifactIds?: readonly string[] | undefined;
  readonly blockers?: readonly string[] | undefined;
  readonly grantIds?: readonly string[] | undefined;
}

function summaryField(value: unknown, name: string): readonly string[] {
  return Object.freeze(textArray(value, name));
}

/**
 * Handoff summaries are immutable snapshots. Later background changes create a
 * new summary revision; they never rewrite the snapshot a recipient prepared
 * against.
 */
export function parseHandoffSummary(value: unknown): HandoffSummary {
  const input = object(value, "HandoffSummary");
  const runState = text(input.runState, "HandoffSummary.runState") as RunState;
  if (!RUN_STATES.includes(runState)) {
    throw new TypeError(`Unsupported HandoffSummary.runState: ${runState}`);
  }
  return Object.freeze({
    id: text(input.id, "HandoffSummary.id"),
    workspaceId: text(input.workspaceId, "HandoffSummary.workspaceId"),
    revision: integer(input.revision, "HandoffSummary.revision"),
    goal: text(input.goal, "HandoffSummary.goal"),
    criteria: text(input.criteria, "HandoffSummary.criteria"),
    runState,
    decisions: summaryField(input.decisions, "HandoffSummary.decisions"),
    completedWork: summaryField(input.completedWork, "HandoffSummary.completedWork"),
    pendingApprovalIds: summaryField(input.pendingApprovalIds, "HandoffSummary.pendingApprovalIds"),
    queueIds: summaryField(input.queueIds, "HandoffSummary.queueIds"),
    todoIds: summaryField(input.todoIds, "HandoffSummary.todoIds"),
    artifactIds: summaryField(input.artifactIds, "HandoffSummary.artifactIds"),
    blockers: summaryField(input.blockers, "HandoffSummary.blockers"),
    grantIds: summaryField(input.grantIds, "HandoffSummary.grantIds"),
  });
}

export function createHandoffSummary(input: CreateHandoffSummaryInput): HandoffSummary {
  return parseHandoffSummary({
    id: input.id,
    workspaceId: input.workspaceId,
    revision: input.revision,
    goal: input.goal,
    criteria: input.criteria,
    runState: input.runState,
    decisions: input.decisions ?? [],
    completedWork: input.completedWork ?? [],
    pendingApprovalIds: input.pendingApprovalIds ?? [],
    queueIds: input.queueIds ?? [],
    todoIds: input.todoIds ?? [],
    artifactIds: input.artifactIds ?? [],
    blockers: input.blockers ?? [],
    grantIds: input.grantIds ?? [],
  });
}
