import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const NOW = "2026-11-22T10:00:00.000Z";
const RUN_ID = "018f2d8f-1002-7f20-80b1-aaaaaaaaaaa2";
const WORKSPACE_ID = "018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4";
const digest = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(
    existsSync(absolute),
    `Phase 2 implementation is missing: ${relativePath}. T014 expects this module to satisfy the foundation contract.`,
  );
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    assignmentId: "018f2d8f-4001-7f20-80b1-ddddddddddd1",
    runId: RUN_ID,
    attemptId: "018f2d8f-4002-7f20-80b1-ddddddddddd2",
    attemptEpoch: 2,
    workspaceId: WORKSPACE_ID,
    workerId: "worker-01",
    conversationPackage: {
      packageDigest: digest(JSON.stringify({ session: "package" })),
      sessionFormatVersion: 1,
      downloadRef: "internal-artifact://assignment/session",
    },
    contextSnapshot: {
      snapshotId: "018f2d8f-4003-7f20-80b1-ddddddddddd3",
      renderedDigest: digest("context"),
    },
    agentProfile: {
      profileId: "018f2d8f-4004-7f20-80b1-ddddddddddd4",
      modelAccessTicket: "short-lived-ticket",
    },
    resourceBudget: {
      cpu: 2,
      memoryMb: 4096,
      processes: 128,
      outputBytes: 20_971_520,
    },
    leaseExpiresAt: "2026-11-22T10:30:00.000Z",
    ...overrides,
  };
}

test("fixed worker pool assigns only configured workers and distinct workspaces", async () => {
  const schedulerModule = await loadModule("apps/runner-api/src/workers/scheduler.ts");
  assert.equal(
    typeof schedulerModule.createWorkerScheduler,
    "function",
    "workers/scheduler.ts must export createWorkerScheduler(options)",
  );

  const workers = [
    { id: "worker-01", capabilities: ["session"], workspaceRoot: "/srv/unspool/worker-01" },
    { id: "worker-02", capabilities: ["session"], workspaceRoot: "/srv/unspool/worker-02" },
  ];
  const scheduler = schedulerModule.createWorkerScheduler({
    workers,
    now: () => NOW,
    leaseDurationMs: 30_000,
  });

  const first = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee1",
    attemptEpoch: 1,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });
  const second = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee2",
    attemptEpoch: 1,
    workspaceId: "workspace-2",
    requiredCapabilities: ["session"],
  });
  const third = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee3",
    attemptEpoch: 1,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(third, null);
  assert.ok(workers.some((worker) => worker.id === first.workerId));
  assert.ok(workers.some((worker) => worker.id === second.workerId));
  assert.notEqual(first.workerId, second.workerId);
  assert.notEqual(first.workspaceRoot, second.workspaceRoot);
  assert.ok(first.workspaceRoot.startsWith("/srv/unspool/worker-"));
  assert.ok(second.workspaceRoot.startsWith("/srv/unspool/worker-"));

  scheduler.release(first.attemptId, first.attemptEpoch, "settled");
  const reused = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee4",
    attemptEpoch: 1,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });
  assert.ok(reused);
  assert.equal(reused.workerId, first.workerId);
});

test("lease heartbeat extends only the current attempt epoch", async () => {
  const schedulerModule = await loadModule("apps/runner-api/src/workers/scheduler.ts");
  const scheduler = schedulerModule.createWorkerScheduler({
    workers: [
      { id: "worker-01", capabilities: ["session"], workspaceRoot: "/srv/unspool/worker-01" },
    ],
    now: () => NOW,
    leaseDurationMs: 30_000,
  });
  const current = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee1",
    attemptEpoch: 2,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });
  assert.ok(current);

  const renewed = scheduler.heartbeat(
    { attemptId: current.attemptId, attemptEpoch: current.attemptEpoch },
    "2026-11-22T10:00:10.000Z",
  );
  assert.ok(
    Date.parse(String(renewed.leaseExpiresAt)) > Date.parse(String(current.leaseExpiresAt)),
  );

  await assert.rejects(
    async () =>
      scheduler.heartbeat(
        { attemptId: current.attemptId, attemptEpoch: current.attemptEpoch - 1 },
        "2026-11-22T10:00:11.000Z",
      ),
    /epoch/i,
  );
});

test("expired dispatched attempts become outcome_unknown without automatic re-dispatch", async () => {
  const schedulerModule = await loadModule("apps/runner-api/src/workers/scheduler.ts");
  const scheduler = schedulerModule.createWorkerScheduler({
    workers: [
      { id: "worker-01", capabilities: ["session"], workspaceRoot: "/srv/unspool/worker-01" },
    ],
    now: () => NOW,
    leaseDurationMs: 30_000,
  });
  const current = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee1",
    attemptEpoch: 3,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });
  assert.ok(current);
  scheduler.markDispatched(current.attemptId, current.attemptEpoch);

  const swept = scheduler.sweep("2026-11-22T10:00:31.000Z");
  assert.ok(
    swept.some(
      (attempt: { attemptId: string; state: string }) =>
        attempt.attemptId === current.attemptId && attempt.state === "outcome_unknown",
    ),
  );
  await assert.rejects(
    async () =>
      scheduler.heartbeat(
        { attemptId: current.attemptId, attemptEpoch: current.attemptEpoch },
        "2026-11-22T10:00:32.000Z",
      ),
    /expired|unknown|epoch/i,
  );

  const automatic = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee9",
    attemptEpoch: 1,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });
  assert.equal(automatic, null);

  scheduler.release(current.attemptId, current.attemptEpoch, "outcome_unknown");
  const afterManualRelease = scheduler.assign({
    runId: RUN_ID,
    attemptId: "018f2d8f-5001-7f20-80b1-eeeeeeeeeee9",
    attemptEpoch: 1,
    workspaceId: WORKSPACE_ID,
    requiredCapabilities: ["session"],
  });
  assert.ok(afterManualRelease);
});

test("worker loads the exact session package, flushes ordered events, and disposes", async () => {
  const lifecycleModule = await loadModule("apps/execution-worker/src/lifecycle.ts");
  assert.equal(
    typeof lifecycleModule.createWorkerLifecycle,
    "function",
    "lifecycle.ts must export createWorkerLifecycle(options)",
  );

  const directory = await mkdtemp(join(tmpdir(), "unspool-worker-"));
  const bytes = new TextEncoder().encode(JSON.stringify({ session: "package" }));
  const batches: Array<Record<string, any>> = [];
  try {
    const lifecycle = lifecycleModule.createWorkerLifecycle({
      workerId: "worker-01",
      now: () => NOW,
      workspaceRoot: directory,
      fetchSessionPackage: async () => bytes,
      uploadEventBatch: async (batch: Record<string, any>) => {
        batches.push(batch);
        return { accepted: true };
      },
    });

    const current = assignment();
    await lifecycle.acceptAssignment(current);
    const loaded = await lifecycle.loadSessionPackage(current.conversationPackage);
    assert.equal(loaded.packageDigest, digest(bytes));
    assert.equal(loaded.byteLength, bytes.byteLength);
    assert.equal(lifecycle.getState().sessionLoaded, true);

    await lifecycle.enqueueEvent({
      kind: "session_started",
      observedAt: "2026-11-22T10:00:01.000Z",
    });
    await lifecycle.enqueueEvent({
      kind: "message_completed",
      observedAt: "2026-11-22T10:00:02.000Z",
    });
    await lifecycle.flushEvents();

    const uploaded = batches.flatMap((batch) => batch.events);
    assert.deepEqual(
      uploaded.map((item: { kind: string }) => item.kind),
      ["session_started", "message_completed"],
    );
    assert.equal(batches[0].workerId, "worker-01");
    assert.equal(batches[0].attemptId, current.attemptId);
    assert.equal(batches[0].attemptEpoch, current.attemptEpoch);
    assert.ok(Number(batches[0].eventSequence) >= 1);

    await lifecycle.shutdown("idle");
    assert.equal(lifecycle.getState().disposed, true);
    await assert.rejects(
      async () =>
        lifecycle.enqueueEvent({
          kind: "message_completed",
          observedAt: "2026-11-22T10:00:03.000Z",
        }),
      /disposed|shutdown/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expired assignments and mismatched session packages are rejected before loading", async () => {
  const lifecycleModule = await loadModule("apps/execution-worker/src/lifecycle.ts");
  const directory = await mkdtemp(join(tmpdir(), "unspool-worker-"));
  const bytes = new TextEncoder().encode("session-package");
  try {
    const expiredLifecycle = lifecycleModule.createWorkerLifecycle({
      workerId: "worker-01",
      now: () => NOW,
      workspaceRoot: directory,
      fetchSessionPackage: async () => bytes,
      uploadEventBatch: async () => ({ accepted: true }),
    });
    await assert.rejects(
      async () =>
        expiredLifecycle.acceptAssignment(
          assignment({ leaseExpiresAt: "2026-11-22T09:59:59.000Z" }),
        ),
      /lease|expired/i,
    );

    const lifecycle = lifecycleModule.createWorkerLifecycle({
      workerId: "worker-01",
      now: () => NOW,
      workspaceRoot: directory,
      fetchSessionPackage: async () => bytes,
      uploadEventBatch: async () => ({ accepted: true }),
    });
    const mismatched = assignment({
      conversationPackage: {
        packageDigest: `sha256:${"0".repeat(64)}`,
        sessionFormatVersion: 1,
        downloadRef: "internal-artifact://assignment/session",
      },
    });
    await lifecycle.acceptAssignment(mismatched);
    await assert.rejects(
      async () => lifecycle.loadSessionPackage(mismatched.conversationPackage),
      /digest/i,
    );
    assert.equal(lifecycle.getState().sessionLoaded, false);

    await lifecycle.acceptAssignment(assignment());
    await assert.rejects(
      async () => lifecycle.acceptAssignment(assignment({ attemptEpoch: 1 })),
      /epoch/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconciliation marks live or entered work unknown and never schedules replay", async () => {
  const lifecycleModule = await loadModule("apps/execution-worker/src/lifecycle.ts");
  assert.equal(
    typeof lifecycleModule.reconcileWorkerAttempt,
    "function",
    "lifecycle.ts must export reconcileWorkerAttempt(input)",
  );

  const checkpoint = {
    piLeafId: "leaf-1",
    lastPersistedEntryId: "entry-1",
    lastProjectedEventId: "event-1",
  };
  const clean = lifecycleModule.reconcileWorkerAttempt({
    lastCheckpoint: checkpoint,
    liveRun: false,
    pendingApproval: false,
    toolEntered: false,
    queueCleared: false,
  });
  assert.equal(clean.outcome, "resumable");
  assert.equal(clean.autoReplay, false);
  assert.equal(clean.lastProjectedEventId, "event-1");

  const unknown = lifecycleModule.reconcileWorkerAttempt({
    lastCheckpoint: checkpoint,
    liveRun: true,
    pendingApproval: true,
    toolEntered: true,
    queueCleared: false,
  });
  assert.equal(unknown.outcome, "needs_confirmation");
  assert.equal(unknown.autoReplay, false);
  assert.equal(unknown.queueState, "unchanged");

  const stopped = lifecycleModule.reconcileWorkerAttempt({
    lastCheckpoint: checkpoint,
    liveRun: true,
    pendingApproval: false,
    toolEntered: false,
    queueCleared: true,
  });
  assert.equal(stopped.outcome, "needs_confirmation");
  assert.equal(stopped.queueState, "withheld");
  assert.equal(stopped.autoReplay, false);
});

test("deployment keeps the Runner and workers off the host Docker socket", () => {
  const composePath = resolve(ROOT, "deploy/docker/compose.yml");
  assert.ok(
    existsSync(composePath),
    "deploy/docker/compose.yml must exist before worker isolation can be verified",
  );
  const compose = readFileSync(composePath, "utf8");
  assert.equal(/docker\.sock/.test(compose), false);
  assert.match(compose, /runner/i);
  assert.match(compose, /worker/i);
  const workerServices = compose.match(/worker-\d+/g) ?? [];
  assert.ok(
    new Set(workerServices).size >= 2,
    "the fixed worker pool must declare at least two isolated worker services",
  );
});
