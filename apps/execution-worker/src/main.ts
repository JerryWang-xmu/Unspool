import {
  type AttemptAssignment,
  type ConversationPackageReference,
  createWorkerLifecycle,
  type DisposeInput,
  type FlushResult,
  type LoadedSessionPackage,
  type ReconciliationInput,
  type ReconciliationResult,
  reconcileWorkerAttempt,
  type WorkerEvent,
  type WorkerLifecycleState,
} from "./lifecycle.js";

export interface LeaseHeartbeatRequest {
  readonly attemptId: string;
  readonly attemptEpoch: number;
  readonly leaseExpiresAt: string | null;
}

export interface ExecutionWorkerRuntimeOptions {
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
    batch: import("./lifecycle.js").WorkerEventBatch,
    assignment: AttemptAssignment,
  ) => Promise<{ readonly accepted?: boolean } | void> | { readonly accepted?: boolean } | void;
  readonly heartbeat?: (
    request: LeaseHeartbeatRequest,
    at: string,
  ) => Promise<string | void> | string | void;
  readonly heartbeatIntervalMs?: number;
  readonly onHeartbeatError?: (error: unknown) => void;
  readonly onDispose?: (reason: string) => Promise<void> | void;
}

export interface ExecutionWorkerRuntime {
  readonly workerId: string;
  acceptAssignment(assignment: AttemptAssignment): Promise<{
    readonly assignment: AttemptAssignment;
    readonly sessionPackage: LoadedSessionPackage | null;
  }>;
  loadSessionPackage(reference: ConversationPackageReference): Promise<LoadedSessionPackage>;
  enqueueEvent(event: WorkerEvent): Promise<void>;
  flushEvents(): Promise<FlushResult | null>;
  heartbeat(at?: Date | string | number): Promise<void>;
  reconcile(input: ReconciliationInput): ReconciliationResult;
  getState(): WorkerLifecycleState & { readonly leaseHeartbeatActive: boolean };
  shutdown(input?: string | DisposeInput): Promise<WorkerLifecycleState>;
  dispose(input?: string | DisposeInput): Promise<WorkerLifecycleState>;
}

const toIso = (value: Date | string | number): string => {
  const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (!Number.isFinite(instant)) {
    throw new TypeError(`Invalid instant: ${String(value)}`);
  }

  return new Date(instant).toISOString();
};

export function createExecutionWorkerRuntime(
  options: ExecutionWorkerRuntimeOptions,
): ExecutionWorkerRuntime {
  const lifecycle = createWorkerLifecycle(options);
  let activeAssignment: AttemptAssignment | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const heartbeat = async (at?: Date | string | number): Promise<void> => {
    if (activeAssignment === null) {
      throw new Error("Worker has no active assignment to heartbeat");
    }
    if (options.heartbeat === undefined) {
      throw new Error("Worker heartbeat transport is not configured");
    }

    const instant = at === undefined ? (options.now?.() ?? new Date()) : at;
    const atIso = toIso(instant);
    const request: LeaseHeartbeatRequest = {
      attemptId: activeAssignment.attemptId,
      attemptEpoch: activeAssignment.attemptEpoch,
      leaseExpiresAt: lifecycle.getState().leaseExpiresAt,
    };
    const renewed = await options.heartbeat(request, atIso);

    if (typeof renewed === "string" && activeAssignment !== null) {
      activeAssignment = { ...activeAssignment, leaseExpiresAt: renewed };
    }
  };

  const startHeartbeat = (): void => {
    if (
      heartbeatTimer !== null ||
      options.heartbeat === undefined ||
      options.heartbeatIntervalMs === undefined
    ) {
      return;
    }
    if (!Number.isFinite(options.heartbeatIntervalMs) || options.heartbeatIntervalMs <= 0) {
      throw new RangeError("heartbeatIntervalMs must be a finite positive value");
    }

    heartbeatTimer = setInterval(() => {
      heartbeat().catch((error: unknown) => {
        options.onHeartbeatError?.(error);
      });
    }, options.heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  };

  const runtime: ExecutionWorkerRuntime = {
    workerId: options.workerId,

    async acceptAssignment(assignment: AttemptAssignment): Promise<{
      readonly assignment: AttemptAssignment;
      readonly sessionPackage: LoadedSessionPackage | null;
    }> {
      await lifecycle.acceptAssignment(assignment);
      activeAssignment = assignment;

      let sessionPackage: LoadedSessionPackage | null = null;
      if (assignment.conversationPackage !== undefined) {
        sessionPackage = await lifecycle.loadSessionPackage(assignment.conversationPackage);
      }

      startHeartbeat();

      return { assignment, sessionPackage };
    },

    loadSessionPackage(reference: ConversationPackageReference): Promise<LoadedSessionPackage> {
      return lifecycle.loadSessionPackage(reference);
    },

    enqueueEvent(event: WorkerEvent): Promise<void> {
      return lifecycle.enqueueEvent(event);
    },

    flushEvents(): Promise<FlushResult | null> {
      return lifecycle.flushEvents();
    },

    heartbeat,

    reconcile(input: ReconciliationInput): ReconciliationResult {
      return reconcileWorkerAttempt(input);
    },

    getState(): WorkerLifecycleState & { readonly leaseHeartbeatActive: boolean } {
      return {
        ...lifecycle.getState(),
        leaseHeartbeatActive: heartbeatTimer !== null,
      };
    },

    async shutdown(input?: string | DisposeInput): Promise<WorkerLifecycleState> {
      clearHeartbeat();
      activeAssignment = null;
      return lifecycle.shutdown(input);
    },

    async dispose(input?: string | DisposeInput): Promise<WorkerLifecycleState> {
      clearHeartbeat();
      activeAssignment = null;
      return lifecycle.dispose(input);
    },
  };

  return runtime;
}

export const createExecutionWorker = createExecutionWorkerRuntime;

export async function main(
  options: ExecutionWorkerRuntimeOptions,
): Promise<ExecutionWorkerRuntime> {
  return createExecutionWorkerRuntime(options);
}
