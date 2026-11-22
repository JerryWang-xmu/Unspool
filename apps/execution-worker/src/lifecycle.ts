import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ConversationPackageReference {
  readonly packageDigest: string;
  readonly sessionFormatVersion?: number;
  readonly downloadRef?: string;
  readonly [key: string]: unknown;
}

export interface AttemptAssignment {
  readonly schemaVersion?: number;
  readonly assignmentId?: string;
  readonly runId?: string;
  readonly attemptId: string;
  readonly attemptEpoch: number;
  readonly workspaceId?: string;
  readonly workerId?: string;
  readonly conversationPackage?: ConversationPackageReference;
  readonly contextSnapshot?: Record<string, unknown>;
  readonly agentProfile?: {
    readonly profileId?: string;
    readonly modelAccessTicket?: string;
    readonly [key: string]: unknown;
  };
  readonly resourceBudget?: Record<string, unknown>;
  readonly leaseExpiresAt: string;
  readonly [key: string]: unknown;
}

export interface WorkerEvent {
  readonly kind: string;
  readonly observedAt?: string;
  readonly [key: string]: unknown;
}

export interface WorkerEventBatch {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly attemptId: string;
  readonly attemptEpoch: number;
  readonly eventSequence: number;
  readonly events: readonly WorkerEvent[];
}

export interface WorkerLifecycleOptions {
  readonly workerId: string;
  readonly now?: () => Date | string | number;
  readonly workspaceRoot: string;
  readonly initialEventSequence?: number;
  readonly maxBatchSize?: number;
  readonly fetchSessionPackage: (
    reference: ConversationPackageReference,
    assignment: AttemptAssignment,
  ) => Promise<Uint8Array | ArrayBuffer | string> | Uint8Array | ArrayBuffer | string;
  readonly uploadEventBatch: (
    batch: WorkerEventBatch,
    assignment: AttemptAssignment,
  ) => Promise<{ readonly accepted?: boolean } | void> | { readonly accepted?: boolean } | void;
  readonly onDispose?: (reason: string) => Promise<void> | void;
}

export interface LoadedSessionPackage {
  readonly packageDigest: string;
  readonly byteLength: number;
  readonly path: string;
  readonly sessionFormatVersion: number | null;
}

export interface WorkerLifecycleState {
  readonly workerId: string;
  readonly attemptId: string | null;
  readonly attemptEpoch: number | null;
  readonly leaseExpiresAt: string | null;
  readonly sessionLoaded: boolean;
  readonly sessionPackageDigest: string | null;
  readonly queuedEvents: number;
  readonly nextEventSequence: number;
  readonly lastUploadedEventSequence: number;
  readonly disposed: boolean;
  readonly stopping: boolean;
  readonly shutdownReason: string | null;
}

export interface FlushResult {
  readonly batches: number;
  readonly uploaded: number;
  readonly lastEventSequence: number;
}

export interface DisposeInput {
  readonly reason?: string;
  readonly attemptEpoch?: number;
  readonly expectedAttemptEpoch?: number;
}

export interface ReconciliationCheckpoint {
  readonly piLeafId?: string | null;
  readonly lastPersistedEntryId?: string | null;
  readonly lastProjectedEventId?: string | null;
  readonly [key: string]: unknown;
}

export interface ReconciliationInput {
  readonly lastCheckpoint?: ReconciliationCheckpoint | null;
  readonly liveRun?: boolean;
  readonly live?: boolean;
  readonly pendingApproval?: boolean;
  readonly approvalPending?: boolean;
  readonly toolEntered?: boolean;
  readonly toolExecutionEntered?: boolean;
  readonly queueCleared?: boolean;
  readonly queueState?: string;
  readonly [key: string]: unknown;
}

export type ReconciliationOutcome = "resumable" | "needs_confirmation";

export interface ReconciliationResult {
  readonly outcome: ReconciliationOutcome;
  readonly autoReplay: false;
  readonly queueState: "unchanged" | "withheld";
  readonly lastProjectedEventId: string | null;
  readonly checkpoint: ReconciliationCheckpoint | null;
  readonly reasons: readonly string[];
}

export interface WorkerLifecycle {
  acceptAssignment(assignment: AttemptAssignment): Promise<void>;
  loadSessionPackage(reference: ConversationPackageReference): Promise<LoadedSessionPackage>;
  enqueueEvent(event: WorkerEvent): Promise<void>;
  flushEvents(): Promise<FlushResult | null>;
  shutdown(input?: string | DisposeInput): Promise<WorkerLifecycleState>;
  dispose(input?: string | DisposeInput): Promise<WorkerLifecycleState>;
  getState(): WorkerLifecycleState;
}

const DEFAULT_MAX_BATCH_SIZE = 100;

const toInstant = (value: Date | string | number, label: string): number => {
  const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (!Number.isFinite(instant)) {
    throw new TypeError(`${label} is not a valid instant: ${String(value)}`);
  }

  return instant;
};

const toIso = (instant: number): string => new Date(instant).toISOString();

const assertNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return value;
};

const assertAttemptEpoch = (value: unknown): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError("attemptEpoch must be a non-negative integer");
  }

  return value as number;
};

const safeSegment = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, "_");

const toBytes = (value: Uint8Array | ArrayBuffer | string): Uint8Array => {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  throw new TypeError("Session package must be bytes or a string");
};

const digestOf = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const reasonFrom = (input: string | DisposeInput | undefined): string => {
  if (typeof input === "string") {
    return input;
  }
  return input?.reason ?? "disposed";
};

const expectedEpochFrom = (input: string | DisposeInput | undefined): number | undefined => {
  if (typeof input === "string" || input === undefined) {
    return undefined;
  }
  return input.attemptEpoch ?? input.expectedAttemptEpoch;
};

export function createWorkerLifecycle(options: WorkerLifecycleOptions): WorkerLifecycle {
  const workerId = assertNonEmptyString(options.workerId, "workerId");
  const workspaceRoot = assertNonEmptyString(options.workspaceRoot, "workspaceRoot");
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const now = options.now ?? (() => new Date());

  if (!Number.isInteger(maxBatchSize) || maxBatchSize <= 0) {
    throw new RangeError("maxBatchSize must be a positive integer");
  }

  let assignment: AttemptAssignment | null = null;
  let leaseExpiresAtMs: number | null = null;
  let loadedSession: LoadedSessionPackage | null = null;
  let attemptDirectory: string | null = null;
  let queue: WorkerEvent[] = [];
  let nextEventSequence = Math.max(1, options.initialEventSequence ?? 1);
  let lastUploadedEventSequence = nextEventSequence - 1;
  let disposed = false;
  let stopping = false;
  let shutdownReason: string | null = null;
  let flushChain: Promise<unknown> = Promise.resolve();

  const clock = (): number => toInstant(now(), "worker clock");

  const ensureOpen = (operation: string): void => {
    if (disposed || stopping) {
      throw new Error(`Worker lifecycle is disposed or shutting down; cannot ${operation}`);
    }
  };

  const ensureLease = (): void => {
    if (leaseExpiresAtMs === null) {
      return;
    }
    if (clock() >= leaseExpiresAtMs) {
      throw new Error(`Attempt lease expired at ${toIso(leaseExpiresAtMs)}`);
    }
  };

  const ensureAssignment = (): AttemptAssignment => {
    if (assignment === null) {
      throw new Error("Worker has no active assignment");
    }
    return assignment;
  };

  const removeAttemptDirectory = async (): Promise<void> => {
    const directory = attemptDirectory;
    attemptDirectory = null;
    loadedSession = null;

    if (directory !== null) {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const disposeInternal = async (reason: string): Promise<WorkerLifecycleState> => {
    if (disposed) {
      return lifecycle.getState();
    }

    disposed = true;
    stopping = true;
    shutdownReason = reason;
    queue = [];
    assignment = null;
    leaseExpiresAtMs = null;

    try {
      await removeAttemptDirectory();
    } finally {
      if (options.onDispose !== undefined) {
        await options.onDispose(reason);
      }
    }

    return lifecycle.getState();
  };

  const verifyDisposeEpoch = (input: string | DisposeInput | undefined): void => {
    const expected = expectedEpochFrom(input);
    if (expected === undefined) {
      return;
    }
    if (assignment === null) {
      throw new Error(`Attempt epoch mismatch: received ${expected} without an active attempt`);
    }
    if (assignment.attemptEpoch !== assertAttemptEpoch(expected)) {
      throw new Error(
        `Attempt epoch mismatch on dispose: current ${assignment.attemptEpoch}, received ${expected}`,
      );
    }
  };

  const performFlush = async (): Promise<FlushResult | null> => {
    if (disposed) {
      throw new Error("Worker lifecycle is disposed; cannot flush events");
    }
    if (queue.length === 0) {
      return null;
    }

    const current = ensureAssignment();
    ensureLease();

    let batches = 0;
    let uploaded = 0;

    while (queue.length > 0) {
      const chunk = queue.slice(0, maxBatchSize);
      const eventSequence = nextEventSequence;
      const batch: WorkerEventBatch = {
        schemaVersion: 1,
        workerId,
        attemptId: current.attemptId,
        attemptEpoch: current.attemptEpoch,
        eventSequence,
        events: chunk.map((event) => ({ ...event })),
      };

      try {
        const result = await options.uploadEventBatch(batch, current);
        if (result !== undefined && result.accepted === false) {
          throw new Error("Worker event batch upload was not accepted");
        }
      } catch (error) {
        queue = [...chunk, ...queue.slice(chunk.length)];
        throw new Error("Worker event batch upload failed", { cause: error });
      }

      queue.splice(0, chunk.length);
      lastUploadedEventSequence = eventSequence;
      nextEventSequence = eventSequence + 1;
      uploaded += chunk.length;
      batches += 1;
    }

    return { batches, uploaded, lastEventSequence: lastUploadedEventSequence };
  };

  const lifecycle: WorkerLifecycle = {
    async acceptAssignment(next: AttemptAssignment): Promise<void> {
      ensureOpen("accept an assignment");

      const attemptId = assertNonEmptyString(next.attemptId, "attemptId");
      const attemptEpoch = assertAttemptEpoch(next.attemptEpoch);
      const leaseExpiresAt = toInstant(next.leaseExpiresAt, "leaseExpiresAt");

      if (next.schemaVersion !== undefined && next.schemaVersion !== 1) {
        throw new Error(`Unsupported assignment schema version: ${String(next.schemaVersion)}`);
      }
      if (next.workerId !== undefined && next.workerId !== workerId) {
        throw new Error(`Assignment targets worker ${next.workerId}, not ${workerId}`);
      }
      if (leaseExpiresAt <= clock()) {
        throw new Error(`Assignment lease expired at ${next.leaseExpiresAt}`);
      }

      const current = assignment;

      if (
        current !== null &&
        current.attemptId === attemptId &&
        current.attemptEpoch === attemptEpoch
      ) {
        const nextDigest = next.conversationPackage?.packageDigest;

        if (
          loadedSession !== null &&
          nextDigest !== undefined &&
          nextDigest !== loadedSession.packageDigest
        ) {
          throw new Error(
            `Session package digest ${nextDigest} does not match the loaded session package`,
          );
        }
        assignment = { ...next };
        leaseExpiresAtMs = leaseExpiresAt;
        return;
      }

      if (
        current !== null &&
        current.attemptId === attemptId &&
        attemptEpoch < current.attemptEpoch
      ) {
        throw new Error(
          `Attempt epoch ${attemptEpoch} is stale for ${attemptId}; current epoch is ${current.attemptEpoch}`,
        );
      }

      const fenced =
        current === null ||
        current.attemptId !== attemptId ||
        attemptEpoch !== current.attemptEpoch;

      if (fenced) {
        await removeAttemptDirectory();
        queue = [];
      }

      assignment = { ...next, attemptId, attemptEpoch };
      leaseExpiresAtMs = leaseExpiresAt;
    },

    async loadSessionPackage(
      reference: ConversationPackageReference,
    ): Promise<LoadedSessionPackage> {
      if (disposed) {
        throw new Error("Worker lifecycle is disposed; cannot load a session package");
      }

      const current = ensureAssignment();
      const expectedDigest = assertNonEmptyString(
        reference.packageDigest,
        "conversationPackage.packageDigest",
      );
      const assignedPackage = current.conversationPackage;

      if (
        assignedPackage?.packageDigest !== undefined &&
        assignedPackage.packageDigest !== expectedDigest
      ) {
        throw new Error(
          `Session package digest ${expectedDigest} does not match assignment digest ` +
            `${assignedPackage.packageDigest}`,
        );
      }
      if (
        assignedPackage?.sessionFormatVersion !== undefined &&
        reference.sessionFormatVersion !== undefined &&
        assignedPackage.sessionFormatVersion !== reference.sessionFormatVersion
      ) {
        throw new Error(
          `Session format version mismatch: expected ${assignedPackage.sessionFormatVersion}, ` +
            `received ${reference.sessionFormatVersion}`,
        );
      }

      ensureLease();

      const bytes = toBytes(await options.fetchSessionPackage(reference, current));
      const actualDigest = digestOf(bytes);

      if (actualDigest !== expectedDigest) {
        throw new Error(
          `Session package digest mismatch: expected ${expectedDigest}, received ${actualDigest}`,
        );
      }

      const directory = join(
        workspaceRoot,
        "sessions",
        safeSegment(current.attemptId),
        `epoch-${current.attemptEpoch}`,
      );
      const target = join(directory, "session-package.bin");
      const temporary = join(directory, `.session-package.${randomUUID()}.tmp`);

      await mkdir(directory, { recursive: true });
      try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rm(target, { force: true });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }

      if (attemptDirectory !== null && attemptDirectory !== directory) {
        await rm(attemptDirectory, { recursive: true, force: true });
      }

      attemptDirectory = directory;
      loadedSession = {
        packageDigest: actualDigest,
        byteLength: bytes.byteLength,
        path: target,
        sessionFormatVersion: reference.sessionFormatVersion ?? null,
      };

      return loadedSession;
    },

    async enqueueEvent(event: WorkerEvent): Promise<void> {
      ensureOpen("enqueue an event");

      const current = ensureAssignment();
      if (typeof event !== "object" || event === null) {
        throw new TypeError("Worker event must be an object");
      }
      assertNonEmptyString(event.kind, "event.kind");
      if (event.observedAt !== undefined) {
        toInstant(event.observedAt, "event.observedAt");
      }

      ensureLease();

      if (current.attemptId.length === 0) {
        throw new Error("Worker has no active attempt");
      }

      queue.push({ ...event });
    },

    async flushEvents(): Promise<FlushResult | null> {
      if (disposed) {
        throw new Error("Worker lifecycle is disposed; cannot flush events");
      }

      const run = flushChain.then(
        () => performFlush(),
        () => performFlush(),
      );
      flushChain = run.catch(() => undefined);
      return run;
    },

    async shutdown(input?: string | DisposeInput): Promise<WorkerLifecycleState> {
      if (disposed) {
        return lifecycle.getState();
      }

      verifyDisposeEpoch(input);

      const reason = reasonFrom(input);
      stopping = true;
      shutdownReason = reason;

      let flushError: unknown;
      try {
        if (queue.length > 0 && assignment !== null) {
          await lifecycle.flushEvents();
        }
      } catch (error) {
        flushError = error;
      }

      await disposeInternal(reason);

      if (flushError !== undefined) {
        throw flushError;
      }

      return lifecycle.getState();
    },

    async dispose(input?: string | DisposeInput): Promise<WorkerLifecycleState> {
      verifyDisposeEpoch(input);
      return disposeInternal(reasonFrom(input));
    },

    getState(): WorkerLifecycleState {
      return {
        workerId,
        attemptId: assignment?.attemptId ?? null,
        attemptEpoch: assignment?.attemptEpoch ?? null,
        leaseExpiresAt: leaseExpiresAtMs === null ? null : toIso(leaseExpiresAtMs),
        sessionLoaded: loadedSession !== null,
        sessionPackageDigest: loadedSession?.packageDigest ?? null,
        queuedEvents: queue.length,
        nextEventSequence,
        lastUploadedEventSequence,
        disposed,
        stopping,
        shutdownReason,
      };
    },
  };

  return lifecycle;
}

export function reconcileWorkerAttempt(input: ReconciliationInput): ReconciliationResult {
  const checkpoint = input.lastCheckpoint ?? null;
  const liveRun = input.liveRun ?? input.live ?? false;
  const pendingApproval = input.pendingApproval ?? input.approvalPending ?? false;
  const toolEntered = input.toolEntered ?? input.toolExecutionEntered ?? false;
  const queueCleared =
    input.queueCleared === true ||
    input.queueState === "cleared" ||
    input.queueState === "withheld" ||
    input.queueState === "stopped";

  const reasons: string[] = [];
  if (liveRun) {
    reasons.push("live_run");
  }
  if (pendingApproval) {
    reasons.push("pending_approval");
  }
  if (toolEntered) {
    reasons.push("tool_execution_entered");
  }
  if (queueCleared) {
    reasons.push("queue_cleared");
  }

  return {
    outcome: reasons.length === 0 ? "resumable" : "needs_confirmation",
    autoReplay: false,
    queueState: queueCleared ? "withheld" : "unchanged",
    lastProjectedEventId:
      typeof checkpoint?.lastProjectedEventId === "string" ? checkpoint.lastProjectedEventId : null,
    checkpoint,
    reasons,
  };
}
