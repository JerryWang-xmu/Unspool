/**
 * T118 / US3 / QS-03.4 / TO-12 / UAT-14, UAT-15, UAT-16.
 *
 * RED recovery and stop tests. Planned surfaces:
 *   - apps/runner-api/src/runs/stop-service.ts (T122)
 *   - apps/runner-api/src/runs/recovery-service.ts (T124)
 *   - packages/pi-adapter/src/event-projector.ts (T121)
 *
 * The recovery service is deliberately event-driven: it aligns durable
 * checkpoints and receipts but never executes a tool. An entered-but-unfinalized
 * tool is outcome_unknown and requires manual confirmation. A queue released
 * after a stop is queued for a new explicit user action, never auto-run.
 */
import { describe, expect, it } from "vitest";
import { reconcileRunAfterCrash } from "../../../apps/runner-api/src/runs/recovery-service";
import {
  handleQueuedInstruction,
  requestRunStop,
} from "../../../apps/runner-api/src/runs/stop-service";
import { projectToolEvents } from "../../../packages/pi-adapter/src/event-projector";

const RUN_ID = "018f2d8f-0d01-7f20-80b1-dddddddddd01";
const WORKSPACE_ID = "018f2d8f-0d02-7f20-80b1-dddddddddd02";
const APPROVAL_ID = "018f2d8f-0d03-7f20-80b1-dddddddddd03";
const TOOL_CALL_ID = "018f2d8f-0d04-7f20-80b1-dddddddddd04";
const NOW = new Date("2026-11-22T10:00:00.000Z");

const CHECKPOINT = {
  leafId: "leaf-42",
  persistedEntryId: "entry-42",
  eventSequence: 42,
  artifactIds: ["artifact-1"],
};

type QueueItem = {
  id: string;
  body: string;
  status: "queued" | "withheld" | "released";
};

function baseRun() {
  return {
    id: RUN_ID,
    workspaceId: WORKSPACE_ID,
    state: "running" as const,
    lastKnownCheckpoint: CHECKPOINT,
    artifacts: ["artifact-1"],
    records: ["turn-1", "turn-2"],
  };
}

function queuedItems(): QueueItem[] {
  return [
    { id: "queue-1", body: "Check the generated report before release.", status: "queued" },
    { id: "queue-2", body: "Call the external endpoint once approved.", status: "queued" },
  ];
}

function makeWorker(
  calls: string[],
  failAt?: "persistQueueSnapshot" | "clearQueue" | "abort" | "drainWrites",
) {
  return {
    persistQueueSnapshot: async (_snapshot: QueueItem[]) => {
      calls.push("persistQueueSnapshot");
      if (failAt === "persistQueueSnapshot") throw new Error("worker died while saving the queue");
    },
    clearQueue: async () => {
      calls.push("clearQueue");
      if (failAt === "clearQueue") throw new Error("worker died after clearQueue");
    },
    abort: async () => {
      calls.push("abort");
      if (failAt === "abort") throw new Error("worker died during abort");
    },
    drainWrites: async () => {
      calls.push("drainWrites");
      if (failAt === "drainWrites") throw new Error("worker died while draining writes");
    },
  };
}

describe("clearQueue before abort and stop confirmation", () => {
  it("requires explicit stop confirmation and otherwise leaves the run and queue untouched", async () => {
    const queue = queuedItems();
    const calls: string[] = [];
    const result = await requestRunStop({
      run: baseRun(),
      queue,
      confirmedStop: false,
      now: NOW,
      worker: makeWorker(calls),
    });

    expect(result.accepted).toBe(false);
    expect(result.code).toBe("confirmation_required");
    expect(calls).toEqual([]);
    expect(result.run.state).toBe("running");
    expect(result.queue).toEqual(queue);
    expect(result.stopOutcome).toBe("not_started");
  });

  it("persists the FIFO snapshot, clears the pi queue, then aborts and drains writes", async () => {
    const queue = queuedItems();
    const calls: string[] = [];
    const result = await requestRunStop({
      run: baseRun(),
      queue,
      confirmedStop: true,
      now: NOW,
      worker: makeWorker(calls),
    });

    expect(result.accepted).toBe(true);
    expect(result.stopOutcome).toBe("stopped");
    expect(calls).toEqual(["persistQueueSnapshot", "clearQueue", "abort", "drainWrites"]);
    expect(result.queueSnapshot).toEqual(queue);
    expect(result.queue.map((item) => item.status)).toEqual(["withheld", "withheld"]);
    expect(result.run.state).toMatch(/stopped|cancelled/);
    expect(result.preserved.artifacts).toEqual(["artifact-1"]);
    expect(result.preserved.records).toEqual(["turn-1", "turn-2"]);
  });

  it("invalidates pending approvals before a stop can leave an executable action behind", async () => {
    const result = await requestRunStop({
      run: {
        ...baseRun(),
        state: "waiting_approval",
        pendingApprovalIds: [APPROVAL_ID],
      },
      queue: queuedItems(),
      confirmedStop: true,
      now: NOW,
      worker: makeWorker([]),
    });

    expect(result.accepted).toBe(true);
    expect(result.invalidatedApprovalIds).toContain(APPROVAL_ID);
    expect(result.queue.every((item) => item.status === "withheld")).toBe(true);
  });

  it("turns any interruption before abort completes into an unknown stop and never resends it", async () => {
    const calls: string[] = [];
    const result = await requestRunStop({
      run: baseRun(),
      queue: queuedItems(),
      confirmedStop: true,
      now: NOW,
      worker: makeWorker(calls, "clearQueue"),
    });

    expect(result.stopOutcome).toBe("unknown");
    expect(result.run.state).toBe("needs_confirmation");
    expect(calls).toEqual(["persistQueueSnapshot", "clearQueue"]);
    expect(result.queue.every((item) => item.status === "withheld")).toBe(true);
  });

  it("does not repeat a stop that is already in progress", async () => {
    const calls: string[] = [];
    const result = await requestRunStop({
      run: { ...baseRun(), state: "stopping" },
      queue: queuedItems(),
      confirmedStop: true,
      now: NOW,
      worker: makeWorker(calls),
    });

    expect(result.code).toBe("already_stopping");
    expect(calls).toEqual([]);
    expect(result.stopOutcome).toBe("unknown");
  });
});

describe("withheld queue handling", () => {
  function stoppedQueue(): QueueItem[] {
    return queuedItems().map((item) => ({ ...item, status: "withheld" as const }));
  }

  it("retains a queued instruction without making it runnable", async () => {
    const result = await handleQueuedInstruction({
      runState: "stopped",
      queue: stoppedQueue(),
      queuedInstructionId: "queue-1",
      action: "retain",
      now: NOW,
    });

    expect(result.code).toBeUndefined();
    expect(result.queue[0]?.status).toBe("withheld");
    expect(result.startedRunId).toBeUndefined();
  });

  it("modifies a withheld instruction while keeping it withheld", async () => {
    const result = await handleQueuedInstruction({
      runState: "stopped",
      queue: stoppedQueue(),
      queuedInstructionId: "queue-1",
      action: "modify",
      editedBody: "Revised and still withheld.",
      now: NOW,
    });

    expect(result.item?.body).toBe("Revised and still withheld.");
    expect(result.item?.status).toBe("withheld");
    expect(result.startedRunId).toBeUndefined();
  });

  it("deletes only the selected withheld instruction", async () => {
    const result = await handleQueuedInstruction({
      runState: "stopped",
      queue: stoppedQueue(),
      queuedInstructionId: "queue-1",
      action: "delete",
      now: NOW,
    });

    expect(result.queue.map((item) => item.id)).toEqual(["queue-2"]);
    expect(result.startedRunId).toBeUndefined();
  });

  it("releases an instruction for a new run only on an explicit user action", async () => {
    const result = await handleQueuedInstruction({
      runState: "stopped",
      queue: stoppedQueue(),
      queuedInstructionId: "queue-2",
      action: "release",
      now: NOW,
    });

    expect(result.item?.status).toBe("queued");
    expect(result.requiresNewRun).toBe(true);
    expect(result.startedRunId).toBeUndefined();
    expect(result.queue.find((item) => item.id === "queue-1")?.status).toBe("withheld");
  });

  it("rejects an action for an unknown queue item", async () => {
    const result = await handleQueuedInstruction({
      runState: "stopped",
      queue: stoppedQueue(),
      queuedInstructionId: "missing",
      action: "retain",
      now: NOW,
    });

    expect(result.code).toBe("not_found");
    expect(result.queue).toHaveLength(2);
  });
});

describe("crash reconciliation and unknown outcomes", () => {
  it("proves a preflight-only action never entered the tool boundary", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [{ kind: "tool_preflight", toolCallId: TOOL_CALL_ID }],
      worker: { state: "crashed" },
      queue: queuedItems(),
      now: NOW,
    });

    expect(result.recovery.outcome).toBe("not_dispatched");
    expect(result.recovery.autoReplay).toBe(false);
    expect(result.recovery.retryRecommended).toBe(false);
    expect(result.run.lastKnownCheckpoint).toEqual(CHECKPOINT);
    expect(result.queue.map((item) => item.body)).toEqual(queuedItems().map((item) => item.body));
  });

  it("marks an entered-but-unfinalized tool as outcome_unknown and keeps the last checkpoint", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [
        { kind: "tool_preflight", toolCallId: TOOL_CALL_ID },
        { kind: "tool_execution_entered", toolCallId: TOOL_CALL_ID },
      ],
      worker: { state: "crashed", inFlightToolCallId: TOOL_CALL_ID },
      queue: queuedItems(),
      now: NOW,
    });

    expect(result.recovery.outcome).toBe("unknown");
    expect(result.recovery.autoReplay).toBe(false);
    expect(result.recovery.retryRecommended).toBe(false);
    expect(result.recovery.requiresManualConfirmation).toBe(true);
    expect(result.run.state).toBe("needs_confirmation");
    expect(result.run.unknownReason).toBeTruthy();
    expect(result.run.businessResult).toBeNull();
    expect(result.run.lastKnownCheckpoint).toEqual(CHECKPOINT);
    expect(result.actions).not.toContain("retry_tool");
  });

  it("keeps outcome unknown when the tool finalized but no durable result receipt exists", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [
        { kind: "tool_preflight", toolCallId: TOOL_CALL_ID },
        { kind: "tool_execution_entered", toolCallId: TOOL_CALL_ID },
        { kind: "tool_finalized", toolCallId: TOOL_CALL_ID },
      ],
      worker: { state: "crashed", inFlightToolCallId: TOOL_CALL_ID },
      resultReceipt: { status: "unknown" },
      queue: queuedItems(),
      now: NOW,
    });

    expect(result.recovery.outcome).toBe("unknown");
    expect(result.recovery.autoReplay).toBe(false);
    expect(result.recovery.requiresManualConfirmation).toBe(true);
    expect(result.run.state).toBe("needs_confirmation");
  });

  it("uses an authoritative known receipt without replaying the tool", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [
        { kind: "tool_preflight", toolCallId: TOOL_CALL_ID },
        { kind: "tool_execution_entered", toolCallId: TOOL_CALL_ID },
        { kind: "tool_finalized", toolCallId: TOOL_CALL_ID },
      ],
      worker: { state: "crashed" },
      resultReceipt: { status: "known", outcome: "succeeded", externalSideEffects: 1 },
      now: NOW,
    });

    expect(result.recovery.outcome).toBe("known");
    expect(result.recovery.autoReplay).toBe(false);
    expect(result.recovery.retryRecommended).toBe(false);
    expect(result.run.businessResult).toBeNull();
    expect(result.actions).not.toContain("execute_tool");
    expect(result.result?.externalSideEffects).toBe(1);
  });

  it("does not claim success or failure for a settled agent before manual result assessment", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [{ kind: "agent_settled" }],
      worker: { state: "online" },
      queue: queuedItems(),
      now: NOW,
    });

    expect(result.run.state).toBe("technical_complete");
    expect(result.run.businessResult).toBeNull();
    expect(result.recovery.requiresManualAssessment).toBe(true);
    expect(result.actions).toContain("manual_result_assessment");
    expect(result.recovery.autoReplay).toBe(false);
  });

  it("keeps a stopped queue withheld when the worker died after clearQueue but before abort", async () => {
    const result = await reconcileRunAfterCrash({
      run: { ...baseRun(), state: "stopping" },
      events: [{ kind: "tool_preflight", toolCallId: TOOL_CALL_ID }],
      worker: { state: "crashed" },
      stop: { requested: true, phase: "after_clear_queue_before_abort" },
      queue: queuedItems(),
      approvals: [{ id: APPROVAL_ID, state: "pending" }],
      now: NOW,
    });

    expect(result.recovery.outcome).toBe("unknown");
    expect(result.recovery.autoReplay).toBe(false);
    expect(result.recovery.requiresManualConfirmation).toBe(true);
    expect(result.queue.every((item) => item.status === "withheld")).toBe(true);
    expect(result.actions).not.toContain("resend_stop");
    expect(result.actions).not.toContain("release_queue");
    expect(result.approvals).toEqual([{ id: APPROVAL_ID, state: "pending" }]);
  });

  it("is idempotent across repeated reconciliation and does not increase side effects", async () => {
    const externalSideEffects = 1;
    const input = {
      run: baseRun(),
      events: [
        { kind: "tool_preflight", toolCallId: TOOL_CALL_ID },
        { kind: "tool_execution_entered", toolCallId: TOOL_CALL_ID },
      ],
      worker: { state: "crashed" as const },
      queue: queuedItems(),
      now: NOW,
    };

    const first = await reconcileRunAfterCrash(input);
    const second = await reconcileRunAfterCrash(input);

    expect(first.recovery.outcome).toBe("unknown");
    expect(second.recovery.outcome).toBe("unknown");
    expect(externalSideEffects).toBe(1);
    expect(second.recovery.autoReplay).toBe(false);
  });

  it("does not persist a transcript merely because message_end arrived", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [{ kind: "message_completed", messageId: "message-1", transcriptPersisted: false }],
      worker: { state: "crashed" },
      now: NOW,
    });

    expect(result.run.transcriptPersisted).toBe(false);
    expect(result.run.state).not.toBe("technical_complete");
    expect(result.run.businessResult).toBeNull();
  });

  it("treats the transcript as persisted only after the durable checkpoint aligns", async () => {
    const result = await reconcileRunAfterCrash({
      run: baseRun(),
      events: [
        { kind: "message_completed", messageId: "message-1", transcriptPersisted: false },
        { kind: "session_checkpoint", checkpoint: CHECKPOINT },
      ],
      checkpoint: CHECKPOINT,
      worker: { state: "online" },
      now: NOW,
    });

    expect(result.run.transcriptPersisted).toBe(true);
    expect(result.run.lastKnownCheckpoint).toEqual(CHECKPOINT);
  });
});

describe("pi event projection safety", () => {
  it("maps a pi tool start to preflight, never to a real execution entry", () => {
    const projected = projectToolEvents([
      { type: "tool_execution_start", toolCallId: TOOL_CALL_ID },
    ]);

    expect(projected[0]?.kind).toBe("tool_preflight");
    expect(projected.some((event) => event.kind === "tool_execution_entered")).toBe(false);
  });

  it("only treats the controlled wrapper event as execution entered", () => {
    const projected = projectToolEvents([
      { type: "tool_execution_start", toolCallId: TOOL_CALL_ID },
      {
        type: "tool_execution_entered",
        toolCallId: TOOL_CALL_ID,
        effectiveArgsDigest: `sha256:${"e".repeat(64)}`,
      },
    ]);

    expect(projected.map((event) => event.kind)).toEqual([
      "tool_preflight",
      "tool_execution_entered",
    ]);
  });

  it("does not mark message_end as persisted before checkpoint alignment", () => {
    const projected = projectToolEvents([{ type: "message_end", messageId: "message-1" }]);

    expect(projected[0]?.kind).toBe("message_completed");
    expect(projected[0]?.transcriptPersisted).toBe(false);
  });
});
