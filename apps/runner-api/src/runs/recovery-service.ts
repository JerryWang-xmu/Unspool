/**
 * Conservative crash reconciliation for a Run after its worker restarted.
 *
 * Reconciliation aligns durable checkpoints and history only. It never
 * executes or retries a tool, never resends a stop and never releases a queue.
 * An entered-but-unfinalized tool, an interrupted stop, or a tool finalized
 * without an authoritative receipt all remain `unknown` and require manual
 * confirmation.
 */

import {
  type PiRecoveryApproval,
  type PiRecoveryQueueItem,
  type PiRecoveryStop,
  RECOVERY_MANUAL_CONFIRMATION_ACTION,
} from "../../../../packages/pi-adapter/src/recovery.js";

const TERMINAL_RUN_STATES: ReadonlySet<string> = new Set([
  "technical_complete",
  "failed",
  "cancelled",
  "stopped",
]);

const COMPLETED_STOP_PHASES: ReadonlySet<string> = new Set(["completed", "stopped", "drained"]);

export interface RecoveryCheckpoint {
  leafId?: string | undefined;
  persistedEntryId?: string | undefined;
  piLeafId?: string | undefined;
  lastPersistedEntryId?: string | undefined;
  eventSequence?: number | undefined;
  artifactIds?: readonly string[] | undefined;
  [key: string]: unknown;
}

export interface RecoveryRunRecord {
  id: string;
  state: string;
  lastKnownState?: string | undefined;
  lastKnownCheckpoint?: unknown;
  transcriptPersisted?: boolean | undefined;
  businessResult?: unknown;
  unknownReason?: string | undefined;
  [key: string]: unknown;
}

export interface RecoveryEvent {
  kind: string;
  toolCallId?: string | undefined;
  checkpoint?: RecoveryCheckpoint | undefined;
  transcriptPersisted?: boolean | undefined;
  [key: string]: unknown;
}

export interface RecoveryWorker {
  state: string;
  inFlightToolCallId?: string | undefined;
}

export interface RecoveryResultReceipt {
  status: string;
  outcome?: string | undefined;
  externalSideEffects?: number | undefined;
  [key: string]: unknown;
}

export interface ReconcileRunAfterCrashInput {
  run: RecoveryRunRecord;
  events?: readonly RecoveryEvent[] | undefined;
  worker: RecoveryWorker;
  queue?: readonly PiRecoveryQueueItem[] | undefined;
  approvals?: readonly PiRecoveryApproval[] | undefined;
  resultReceipt?: RecoveryResultReceipt | undefined;
  checkpoint?: RecoveryCheckpoint | undefined;
  stop?: PiRecoveryStop | undefined;
  now: Date;
}

export type RecoveryOutcome = "not_dispatched" | "unknown" | "known";

export interface RunRecoveryAssessment {
  outcome: RecoveryOutcome;
  autoReplay: false;
  retryRecommended: boolean;
  requiresManualConfirmation?: boolean | undefined;
  requiresManualAssessment?: boolean | undefined;
}

export interface ReconcileRunAfterCrashResult {
  run: RecoveryRunRecord;
  recovery: RunRecoveryAssessment;
  actions: string[];
  queue: PiRecoveryQueueItem[];
  approvals: PiRecoveryApproval[];
  result?: RecoveryResultReceipt | undefined;
}

function asCheckpoint(value: unknown): RecoveryCheckpoint | undefined {
  return typeof value === "object" && value !== null ? (value as RecoveryCheckpoint) : undefined;
}

function checkpointLeaf(checkpoint: RecoveryCheckpoint): string | undefined {
  if (typeof checkpoint.leafId === "string") return checkpoint.leafId;
  if (typeof checkpoint.piLeafId === "string") return checkpoint.piLeafId;
  return undefined;
}

function checkpointEntry(checkpoint: RecoveryCheckpoint): string | undefined {
  if (typeof checkpoint.persistedEntryId === "string") return checkpoint.persistedEntryId;
  if (typeof checkpoint.lastPersistedEntryId === "string") return checkpoint.lastPersistedEntryId;
  return undefined;
}

function hasCheckpointIdentity(checkpoint: RecoveryCheckpoint): boolean {
  return checkpointLeaf(checkpoint) !== undefined || checkpointEntry(checkpoint) !== undefined;
}

function checkpointsAlign(left: RecoveryCheckpoint, right: RecoveryCheckpoint): boolean {
  if (!hasCheckpointIdentity(left) || !hasCheckpointIdentity(right)) return false;
  const leftLeaf = checkpointLeaf(left);
  const rightLeaf = checkpointLeaf(right);
  const leftEntry = checkpointEntry(left);
  const rightEntry = checkpointEntry(right);
  if (leftLeaf !== undefined && rightLeaf !== undefined && leftLeaf !== rightLeaf) return false;
  if (leftEntry !== undefined && rightEntry !== undefined && leftEntry !== rightEntry) {
    return false;
  }
  return true;
}

function cloneCheckpoint(checkpoint: RecoveryCheckpoint): RecoveryCheckpoint {
  const clone: RecoveryCheckpoint = { ...checkpoint };
  if (Array.isArray(checkpoint.artifactIds)) clone.artifactIds = [...checkpoint.artifactIds];
  return clone;
}

function findCheckpointEvent(events: readonly RecoveryEvent[]): RecoveryCheckpoint | undefined {
  for (const event of events) {
    if (event.kind !== "session_checkpoint" && event.kind !== "checkpoint_aligned") continue;
    const checkpoint = asCheckpoint(event.checkpoint);
    if (checkpoint !== undefined) return checkpoint;
  }
  return undefined;
}

export function reconcileRunAfterCrash(
  input: ReconcileRunAfterCrashInput,
): ReconcileRunAfterCrashResult {
  const events = input.events ?? [];
  const { run, worker } = input;
  const crashed = worker.state === "crashed";
  const stopInterrupted =
    input.stop?.requested === true && !COMPLETED_STOP_PHASES.has(input.stop.phase);
  const hasEnteredExecution =
    worker.inFlightToolCallId !== undefined ||
    events.some((event) => event.kind === "tool_execution_entered");
  const hasPreflight = events.some((event) => event.kind === "tool_preflight");
  const hasFinalized = events.some((event) => event.kind === "tool_finalized");
  const hasExplicitUnknown = events.some((event) => event.kind === "execution_unknown");
  const settled = events.some((event) => event.kind === "agent_settled");
  const receiptKnown = input.resultReceipt?.status === "known";

  let outcome: RecoveryOutcome;
  if (stopInterrupted || hasExplicitUnknown) {
    outcome = "unknown";
  } else if (hasEnteredExecution) {
    outcome = receiptKnown ? "known" : "unknown";
  } else if (hasFinalized) {
    // A final signal without an execution-entered record cannot prove whether
    // the side-effect boundary was crossed, so it is never treated as known.
    outcome = "unknown";
  } else if (hasPreflight) {
    outcome = "not_dispatched";
  } else if (settled) {
    outcome = "known";
  } else if (crashed) {
    outcome = "unknown";
  } else {
    outcome = "known";
  }

  const inputCheckpoint = input.checkpoint;
  const eventCheckpoint = findCheckpointEvent(events);
  const checkpointAligned =
    eventCheckpoint !== undefined &&
    (inputCheckpoint === undefined
      ? hasCheckpointIdentity(eventCheckpoint)
      : checkpointsAlign(eventCheckpoint, inputCheckpoint));
  const durableCheckpoint =
    inputCheckpoint ??
    (checkpointAligned ? eventCheckpoint : undefined) ??
    asCheckpoint(run.lastKnownCheckpoint);

  const transcriptPersisted = checkpointAligned || run.transcriptPersisted === true;
  const terminal = TERMINAL_RUN_STATES.has(run.state);
  const needsConfirmation =
    !terminal && !settled && (crashed || outcome === "unknown" || stopInterrupted);

  const nextRun: RecoveryRunRecord = {
    ...run,
    transcriptPersisted,
    ...(terminal ? {} : { businessResult: null }),
  };
  if (durableCheckpoint !== undefined)
    nextRun.lastKnownCheckpoint = cloneCheckpoint(durableCheckpoint);

  if (!terminal && settled) {
    nextRun.state = "technical_complete";
    nextRun.lastKnownState = run.lastKnownState ?? run.state;
  } else if (needsConfirmation) {
    nextRun.state = "needs_confirmation";
    nextRun.lastKnownState = run.lastKnownState ?? run.state;
    nextRun.unknownReason = stopInterrupted
      ? "stop_outcome_unknown"
      : outcome === "unknown"
        ? "execution_outcome_unknown"
        : "worker_crashed";
  }

  const requiresManualConfirmation = needsConfirmation;
  const requiresManualAssessment =
    (!terminal && settled) || (outcome === "known" && crashed && !terminal);

  const actions: string[] = [];
  if (requiresManualAssessment) actions.push("manual_result_assessment");
  if (requiresManualConfirmation) actions.push(RECOVERY_MANUAL_CONFIRMATION_ACTION);

  return {
    run: nextRun,
    recovery: {
      outcome,
      autoReplay: false,
      retryRecommended: false,
      requiresManualConfirmation,
      requiresManualAssessment,
    },
    actions,
    queue: (input.queue ?? []).map((item) => ({ ...item, status: "withheld" })),
    approvals: (input.approvals ?? []).map((approval) => ({ ...approval })),
    ...(input.resultReceipt === undefined ? {} : { result: { ...input.resultReceipt } }),
  };
}
