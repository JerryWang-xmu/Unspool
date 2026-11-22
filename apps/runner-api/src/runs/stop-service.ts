/**
 * Stop transactions and manual handling of a withheld queue.
 *
 * A stop is a fixed transaction: persist the self-managed FIFO snapshot,
 * clear the pi queue, abort the session, then drain the write channel. Any
 * interruption leaves the outcome unknown and the queue withheld; nothing is
 * resent or replayed automatically.
 */

export interface StopRunRecord {
  id: string;
  state: string;
  artifacts?: readonly unknown[] | undefined;
  records?: readonly unknown[] | undefined;
  pendingApprovalIds?: readonly string[] | undefined;
  lastKnownState?: string | undefined;
  unknownReason?: string | undefined;
  [key: string]: unknown;
}

export interface StopQueueItem {
  id: string;
  body: string;
  status: string;
  [key: string]: unknown;
}

export interface RunStopWorker {
  persistQueueSnapshot(snapshot: readonly StopQueueItem[]): Promise<void>;
  clearQueue(): Promise<void>;
  abort(): Promise<void>;
  drainWrites(): Promise<void>;
}

export interface RunStopInput {
  run: StopRunRecord;
  queue: readonly StopQueueItem[];
  confirmedStop: boolean;
  now: Date;
  worker: RunStopWorker;
}

export type RunStopOutcome = "not_started" | "stopped" | "unknown";

export interface PreservedRunProgress {
  artifacts: unknown[];
  records: unknown[];
}

export interface RunStopResult {
  accepted: boolean;
  code?: "confirmation_required" | "already_stopping" | undefined;
  stopOutcome: RunStopOutcome;
  run: StopRunRecord;
  queue: StopQueueItem[];
  queueSnapshot: StopQueueItem[];
  preserved: PreservedRunProgress;
  invalidatedApprovalIds: string[];
}

export type QueuedInstructionAction = "retain" | "modify" | "delete" | "release";

export interface QueuedInstructionInput {
  runState: string;
  queue: readonly StopQueueItem[];
  queuedInstructionId: string;
  action: QueuedInstructionAction;
  editedBody?: string | undefined;
  now: Date;
}

export interface QueuedInstructionResult {
  code?: "not_found" | "run_active" | "not_withheld" | "edited_body_required" | undefined;
  queue: StopQueueItem[];
  item?: StopQueueItem | undefined;
  requiresNewRun?: true | undefined;
  startedRunId?: undefined;
}

const ACTIVE_RUN_STATES: ReadonlySet<string> = new Set([
  "created",
  "running",
  "waiting_approval",
  "stopping",
]);

function cloneQueue(queue: readonly StopQueueItem[]): StopQueueItem[] {
  return queue.map((item) => ({ ...item }));
}

function withholdQueue(queue: readonly StopQueueItem[]): StopQueueItem[] {
  return queue.map((item) => ({ ...item, status: "withheld" }));
}

function preservedProgress(run: StopRunRecord): PreservedRunProgress {
  return {
    artifacts: [...(run.artifacts ?? [])],
    records: [...(run.records ?? [])],
  };
}

export async function requestRunStop(input: RunStopInput): Promise<RunStopResult> {
  const { run, confirmedStop, now, worker } = input;
  const queueSnapshot = cloneQueue(input.queue);
  const preserved = preservedProgress(run);

  if (!confirmedStop) {
    return {
      accepted: false,
      code: "confirmation_required",
      stopOutcome: "not_started",
      run: { ...run },
      queue: cloneQueue(input.queue),
      queueSnapshot,
      preserved,
      invalidatedApprovalIds: [],
    };
  }

  if (run.state === "stopping") {
    return {
      accepted: false,
      code: "already_stopping",
      stopOutcome: "unknown",
      run: { ...run },
      queue: cloneQueue(input.queue),
      queueSnapshot,
      preserved,
      invalidatedApprovalIds: [],
    };
  }

  const withheldQueue = withholdQueue(input.queue);
  const invalidatedApprovalIds = [...(run.pendingApprovalIds ?? [])];
  const baseRun: StopRunRecord =
    invalidatedApprovalIds.length > 0 ? { ...run, pendingApprovalIds: [] } : { ...run };

  try {
    await worker.persistQueueSnapshot(queueSnapshot);
    await worker.clearQueue();
    await worker.abort();
    await worker.drainWrites();
  } catch {
    return {
      accepted: true,
      stopOutcome: "unknown",
      run: {
        ...baseRun,
        state: "needs_confirmation",
        lastKnownState: run.lastKnownState ?? run.state,
        unknownReason: "stop_outcome_unknown",
      },
      queue: withheldQueue,
      queueSnapshot,
      preserved,
      invalidatedApprovalIds,
    };
  }

  return {
    accepted: true,
    stopOutcome: "stopped",
    run: {
      ...baseRun,
      state: "stopped",
      lastKnownState: run.lastKnownState ?? run.state,
      endedAt: now.toISOString(),
    },
    queue: withheldQueue,
    queueSnapshot,
    preserved,
    invalidatedApprovalIds,
  };
}

export async function handleQueuedInstruction(
  input: QueuedInstructionInput,
): Promise<QueuedInstructionResult> {
  const queue = cloneQueue(input.queue);

  if (ACTIVE_RUN_STATES.has(input.runState)) {
    return { code: "run_active", queue };
  }

  const index = queue.findIndex((item) => item.id === input.queuedInstructionId);
  const current = queue[index];
  if (current === undefined) {
    return { code: "not_found", queue };
  }
  if (current.status !== "withheld") {
    return { code: "not_withheld", queue, item: { ...current } };
  }

  switch (input.action) {
    case "retain":
      return { queue, item: { ...current, status: "withheld" } };

    case "modify": {
      const editedBody = input.editedBody;
      if (typeof editedBody !== "string" || editedBody.trim().length === 0) {
        return { code: "edited_body_required", queue, item: { ...current } };
      }
      const modified: StopQueueItem = { ...current, body: editedBody, status: "withheld" };
      queue[index] = modified;
      return { queue, item: modified };
    }

    case "delete":
      queue.splice(index, 1);
      return { queue };

    case "release": {
      const released: StopQueueItem = { ...current, status: "queued" };
      queue[index] = released;
      return { queue, item: released, requiresNewRun: true };
    }
  }
}
