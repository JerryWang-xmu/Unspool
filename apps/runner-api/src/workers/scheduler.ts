import { randomUUID } from "node:crypto";

export interface SchedulerWorker {
  readonly id: string;
  readonly capabilities: readonly string[];
  readonly workspaceRoot: string;
}

export interface AssignmentRequest {
  readonly runId: string;
  readonly attemptId: string;
  readonly attemptEpoch: number;
  readonly workspaceId: string;
  readonly requiredCapabilities?: readonly string[];
  readonly workerId?: string;
}

export type AttemptState = "assigned" | "dispatched" | "outcome_unknown" | "expired" | "released";

export interface WorkerAssignment {
  readonly schemaVersion: 1;
  readonly assignmentId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly attemptEpoch: number;
  readonly workspaceId: string;
  readonly workerId: string;
  readonly workspaceRoot: string;
  readonly leaseExpiresAt: string;
  readonly state: AttemptState;
  readonly requiredCapabilities: readonly string[];
}

export interface WorkerSchedulerOptions {
  readonly workers: readonly SchedulerWorker[];
  readonly now?: () => Date | string | number;
  readonly leaseDurationMs?: number;
}

export interface LeaseReference {
  readonly attemptId: string;
  readonly attemptEpoch: number;
}

interface AttemptRecord {
  assignmentId: string;
  runId: string;
  attemptId: string;
  attemptEpoch: number;
  workspaceId: string;
  workerId: string;
  workspaceRoot: string;
  leaseExpiresAtMs: number;
  state: AttemptState;
  requiredCapabilities: readonly string[];
  assignedAt: string;
  dispatchedAt?: string | undefined;
  unknownReason?: string | undefined;
  sweptAt?: string | undefined;
  releaseReason?: string | undefined;
  releasedAt?: string | undefined;
}

export interface WorkerScheduler {
  assign(input: AssignmentRequest): WorkerAssignment | null;
  heartbeat(reference: LeaseReference, at?: Date | string | number): WorkerAssignment;
  markDispatched(
    attemptId: string,
    attemptEpoch: number,
    at?: Date | string | number,
  ): WorkerAssignment;
  release(attemptId: string, attemptEpoch: number, reason?: string): WorkerAssignment;
  sweep(at?: Date | string | number): WorkerAssignment[];
  getAttempt(attemptId: string): WorkerAssignment | undefined;
}

const DEFAULT_LEASE_DURATION_MS = 30_000;

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

const copyAssignment = (record: AttemptRecord): WorkerAssignment => ({
  schemaVersion: 1,
  assignmentId: record.assignmentId,
  runId: record.runId,
  attemptId: record.attemptId,
  attemptEpoch: record.attemptEpoch,
  workspaceId: record.workspaceId,
  workerId: record.workerId,
  workspaceRoot: record.workspaceRoot,
  leaseExpiresAt: toIso(record.leaseExpiresAtMs),
  state: record.state,
  requiredCapabilities: [...record.requiredCapabilities],
});

const copyReleased = (record: AttemptRecord): WorkerAssignment => ({
  schemaVersion: 1,
  assignmentId: record.assignmentId,
  runId: record.runId,
  attemptId: record.attemptId,
  attemptEpoch: record.attemptEpoch,
  workspaceId: record.workspaceId,
  workerId: record.workerId,
  workspaceRoot: record.workspaceRoot,
  leaseExpiresAt: toIso(record.leaseExpiresAtMs),
  state: "released",
  requiredCapabilities: [...record.requiredCapabilities],
});

const hasCapabilities = (worker: SchedulerWorker, required: readonly string[]): boolean =>
  required.every(
    (capability) => worker.capabilities.includes(capability) || worker.capabilities.includes("*"),
  );

export function createWorkerScheduler(options: WorkerSchedulerOptions): WorkerScheduler {
  const workers = [...options.workers];
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const now = options.now ?? (() => new Date());

  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new RangeError("leaseDurationMs must be a finite positive value");
  }

  const workersById = new Map<string, SchedulerWorker>();
  const workspaceRoots = new Set<string>();

  for (const worker of workers) {
    assertNonEmptyString(worker.id, "worker.id");
    assertNonEmptyString(worker.workspaceRoot, "worker.workspaceRoot");

    if (workersById.has(worker.id)) {
      throw new Error(`Duplicate scheduler worker id: ${worker.id}`);
    }
    if (workspaceRoots.has(worker.workspaceRoot)) {
      throw new Error(`Duplicate scheduler workspace root: ${worker.workspaceRoot}`);
    }

    workersById.set(worker.id, worker);
    workspaceRoots.add(worker.workspaceRoot);
  }

  const active = new Map<string, AttemptRecord>();
  const released = new Map<string, AttemptRecord>();
  const workerAssignments = new Map<string, string>();
  const workspaceAssignments = new Map<string, string>();

  const clock = (): number => toInstant(now(), "scheduler clock");

  const freeAttempt = (record: AttemptRecord): void => {
    if (workerAssignments.get(record.workerId) === record.attemptId) {
      workerAssignments.delete(record.workerId);
    }
    if (workspaceAssignments.get(record.workspaceId) === record.attemptId) {
      workspaceAssignments.delete(record.workspaceId);
    }
  };

  const findActive = (attemptId: string): AttemptRecord | undefined => active.get(attemptId);

  const requireCurrent = (reference: LeaseReference): AttemptRecord => {
    const record = findActive(assertNonEmptyString(reference.attemptId, "attemptId"));

    if (record === undefined) {
      throw new Error(`Unknown or released attempt: ${reference.attemptId}`);
    }
    if (record.attemptEpoch !== assertAttemptEpoch(reference.attemptEpoch)) {
      throw new Error(
        `Attempt epoch mismatch for ${reference.attemptId}: current ${record.attemptEpoch}, ` +
          `received ${reference.attemptEpoch}`,
      );
    }

    return record;
  };

  const expireDispatched = (record: AttemptRecord, at: number): boolean => {
    if (record.state === "outcome_unknown") {
      return false;
    }
    if (record.state === "dispatched") {
      record.state = "outcome_unknown";
      record.unknownReason = "lease_expired";
      record.sweptAt = toIso(at);
      return true;
    }

    record.state = "expired";
    record.sweptAt = toIso(at);
    freeAttempt(record);
    active.delete(record.attemptId);
    released.set(record.attemptId, record);
    return true;
  };

  const assertLeaseCurrent = (record: AttemptRecord, at: number): void => {
    if (at < record.leaseExpiresAtMs) {
      return;
    }

    expireDispatched(record, at);
    throw new Error(
      `Attempt lease expired for ${record.attemptId} at ${toIso(record.leaseExpiresAtMs)}`,
    );
  };

  const scheduler: WorkerScheduler = {
    assign(input: AssignmentRequest): WorkerAssignment | null {
      const runId = assertNonEmptyString(input.runId, "runId");
      const attemptId = assertNonEmptyString(input.attemptId, "attemptId");
      const workspaceId = assertNonEmptyString(input.workspaceId, "workspaceId");
      const attemptEpoch = assertAttemptEpoch(input.attemptEpoch);
      const requiredCapabilities = [...(input.requiredCapabilities ?? [])];

      for (const capability of requiredCapabilities) {
        assertNonEmptyString(capability, "requiredCapabilities[]");
      }

      const existing = findActive(attemptId);
      if (existing !== undefined) {
        if (existing.attemptEpoch !== attemptEpoch) {
          throw new Error(
            `Attempt epoch mismatch for ${attemptId}: current ${existing.attemptEpoch}, ` +
              `received ${attemptEpoch}`,
          );
        }
        if (
          existing.runId === runId &&
          existing.workspaceId === workspaceId &&
          (input.workerId === undefined || input.workerId === existing.workerId)
        ) {
          return copyAssignment(existing);
        }

        throw new Error(`Attempt ${attemptId} already has an active assignment`);
      }

      const previous = released.get(attemptId);
      if (previous !== undefined) {
        if (previous.attemptEpoch !== attemptEpoch) {
          throw new Error(
            `Attempt epoch mismatch for released attempt ${attemptId}: ` +
              `previous ${previous.attemptEpoch}, received ${attemptEpoch}`,
          );
        }
        throw new Error(`Attempt ${attemptId} was already released and cannot be reassigned`);
      }

      if (input.workerId !== undefined && !workersById.has(input.workerId)) {
        return null;
      }

      const selected = workers.find(
        (worker) =>
          (input.workerId === undefined || worker.id === input.workerId) &&
          hasCapabilities(worker, requiredCapabilities) &&
          !workerAssignments.has(worker.id) &&
          !workspaceAssignments.has(workspaceId),
      );

      if (selected === undefined) {
        return null;
      }

      const instant = clock();
      const record: AttemptRecord = {
        assignmentId: randomUUID(),
        runId,
        attemptId,
        attemptEpoch,
        workspaceId,
        workerId: selected.id,
        workspaceRoot: selected.workspaceRoot,
        leaseExpiresAtMs: instant + leaseDurationMs,
        state: "assigned",
        requiredCapabilities,
        assignedAt: toIso(instant),
      };

      active.set(attemptId, record);
      workerAssignments.set(selected.id, attemptId);
      workspaceAssignments.set(workspaceId, attemptId);

      return copyAssignment(record);
    },

    heartbeat(reference: LeaseReference, at?: Date | string | number): WorkerAssignment {
      const record = requireCurrent(reference);
      const instant = at === undefined ? clock() : toInstant(at, "heartbeat time");

      assertLeaseCurrent(record, instant);

      if (record.state === "outcome_unknown") {
        throw new Error(
          `Attempt ${record.attemptId} is outcome_unknown and cannot renew its lease`,
        );
      }

      record.leaseExpiresAtMs = instant + leaseDurationMs;

      return copyAssignment(record);
    },

    markDispatched(
      attemptId: string,
      attemptEpoch: number,
      at?: Date | string | number,
    ): WorkerAssignment {
      const record = requireCurrent({ attemptId, attemptEpoch });
      const instant = at === undefined ? clock() : toInstant(at, "dispatch time");

      assertLeaseCurrent(record, instant);

      if (record.state === "expired") {
        throw new Error(`Attempt ${record.attemptId} lease expired before dispatch`);
      }
      if (record.state === "outcome_unknown") {
        throw new Error(`Attempt ${record.attemptId} is outcome_unknown and cannot be dispatched`);
      }

      record.state = "dispatched";
      record.dispatchedAt = toIso(instant);

      return copyAssignment(record);
    },

    release(attemptId: string, attemptEpoch: number, reason = "settled"): WorkerAssignment {
      const current = findActive(assertNonEmptyString(attemptId, "attemptId"));

      if (current === undefined) {
        const previous = released.get(attemptId);

        if (previous !== undefined) {
          if (previous.attemptEpoch !== assertAttemptEpoch(attemptEpoch)) {
            throw new Error(
              `Attempt epoch mismatch for released attempt ${attemptId}: ` +
                `previous ${previous.attemptEpoch}, received ${attemptEpoch}`,
            );
          }

          return copyReleased(previous);
        }

        throw new Error(`Unknown attempt: ${attemptId}`);
      }

      if (current.attemptEpoch !== assertAttemptEpoch(attemptEpoch)) {
        throw new Error(
          `Attempt epoch mismatch for ${attemptId}: current ${current.attemptEpoch}, ` +
            `received ${attemptEpoch}`,
        );
      }

      freeAttempt(current);
      current.state = "released";
      current.releaseReason = reason;
      current.releasedAt = toIso(clock());
      active.delete(attemptId);
      released.set(attemptId, current);

      return copyReleased(current);
    },

    sweep(at?: Date | string | number): WorkerAssignment[] {
      const instant = at === undefined ? clock() : toInstant(at, "sweep time");
      const swept: WorkerAssignment[] = [];

      for (const record of [...active.values()]) {
        if (record.state === "outcome_unknown" || instant < record.leaseExpiresAtMs) {
          continue;
        }

        if (expireDispatched(record, instant)) {
          swept.push(copyAssignment(record));
        }
      }

      return swept;
    },

    getAttempt(attemptId: string): WorkerAssignment | undefined {
      const current = findActive(attemptId);
      if (current !== undefined) {
        return copyAssignment(current);
      }

      const previous = released.get(attemptId);
      return previous === undefined ? undefined : copyReleased(previous);
    },
  };

  return scheduler;
}
