/**
 * Conservative reconciliation for a pi session after a worker restart.
 *
 * Reconciliation only aligns durable history. A live run, its approvals, its
 * executing tools and its queue cannot be trusted automatically, so they are
 * projected as `needs_confirmation` with replay disabled.
 */

import type { PiSessionCheckpoint } from "./session-adapter.js";

export const RECOVERY_MANUAL_CONFIRMATION_ACTION = "manual_confirmation_required";

const TERMINAL_RUN_STATES: ReadonlySet<string> = new Set([
  "technical_complete",
  "failed",
  "cancelled",
]);

export interface PiRecoveryRun {
  id: string;
  state: string;
  lastKnownState?: string | undefined;
  lastKnownCheckpoint?: PiSessionCheckpoint | undefined;
  [key: string]: unknown;
}

export interface PiRecoveryApproval {
  id: string;
  state: string;
  lastKnownState?: string | undefined;
  [key: string]: unknown;
}

export interface PiRecoveryExecutingTool {
  toolCallId: string;
  toolName?: string | undefined;
  state?: string | undefined;
  lastKnownState?: string | undefined;
  [key: string]: unknown;
}

export interface PiRecoveryQueueItem {
  id: string;
  body: string;
  kind?: string | undefined;
  status?: string | undefined;
  [key: string]: unknown;
}

export interface PiRecoveryStop {
  requested: boolean;
  phase: string;
  [key: string]: unknown;
}

export interface ReconcilePiSessionInput {
  checkpoint: PiSessionCheckpoint;
  live: {
    run: PiRecoveryRun | null;
    approvals: readonly PiRecoveryApproval[];
    executingTools: readonly PiRecoveryExecutingTool[];
    queue: readonly PiRecoveryQueueItem[];
    stop?: PiRecoveryStop | undefined;
  };
}

export interface PiSessionReconciliation {
  run: PiRecoveryRun | null;
  approvals: PiRecoveryApproval[];
  executingTools: PiRecoveryExecutingTool[];
  queue: PiRecoveryQueueItem[];
  actions: string[];
  autoReplay: false;
}

export function reconcilePiSession(input: ReconcilePiSessionInput): PiSessionReconciliation {
  const { run } = input.live;

  if (run === null || TERMINAL_RUN_STATES.has(run.state)) {
    return {
      run: run === null ? null : { ...run },
      approvals: [...input.live.approvals],
      executingTools: [...input.live.executingTools],
      queue: [...input.live.queue],
      actions: [],
      autoReplay: false,
    };
  }

  return {
    run: {
      ...run,
      state: "needs_confirmation",
      lastKnownState: run.lastKnownState ?? run.state,
      lastKnownCheckpoint: {
        ...input.checkpoint,
        artifactIds: [...input.checkpoint.artifactIds],
      },
    },
    approvals: input.live.approvals.map((approval) => ({
      ...approval,
      state: "needs_confirmation",
      lastKnownState: approval.lastKnownState ?? approval.state,
    })),
    executingTools: input.live.executingTools.map((tool) => ({
      ...tool,
      state: "needs_confirmation",
      lastKnownState: tool.lastKnownState ?? tool.state,
    })),
    queue: input.live.queue.map((item) => ({
      ...item,
      status: "withheld",
    })),
    actions: [RECOVERY_MANUAL_CONFIRMATION_ACTION],
    autoReplay: false,
  };
}
