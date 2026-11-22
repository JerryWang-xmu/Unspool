/**
 * T049 / US1 / QS-01, QS-03 / TO-12.
 *
 * RED contract for the pi adapter boundary. The imports below intentionally
 * name the planned production modules from tasks T043, T073 and T124:
 *   - packages/pi-adapter/src/session-registry.ts
 *   - packages/pi-adapter/src/session-adapter.ts
 *   - packages/pi-adapter/src/recovery.ts
 *
 * Expected API:
 *   openWorkspaceSession(input) -> { sessionManager, session, extensionsResult }
 *   createPiSessionAdapter(input) -> { start, steer, followUp, stop, checkpoint }
 *   reconcilePiSession(input) -> { run, approvals, executingTools, queue, actions, autoReplay }
 *
 * The registry receives the pi SDK as an injected port so this test can spy on
 * SessionManager without touching a real session file or model provider. The
 * adapter must still use exactly SessionManager.open() for the requested path:
 * continueRecent() is forbidden because it may restore another task's session.
 *
 * Contract sources:
 * - specs/001-agent-federated-collaboration/contracts/worker-protocol.md §2-§4, §7
 * - specs/001-agent-federated-collaboration/research.md D-10
 * - specs/001-agent-federated-collaboration/quickstart.md QS-01, QS-03
 */
import { describe, expect, it, vi } from "vitest";
import { reconcilePiSession } from "../../../packages/pi-adapter/src/recovery";
import { createPiSessionAdapter } from "../../../packages/pi-adapter/src/session-adapter";
import { openWorkspaceSession } from "../../../packages/pi-adapter/src/session-registry";

const WORKSPACE_ID = "018f2d8f-0e01-7f20-80b1-eeeeeeeeeee1";
const SESSION_PATH = "C:/unspool/sessions/ws-1/session.jsonl";
const SESSION_DIR = "C:/unspool/sessions/ws-1";
const CWD = "C:/unspool/workspaces/ws-1";
const APPROVAL_EXTENSION_PATH = "C:/unspool/extensions/approval-gate/index.ts";
const RUN_ID = "018f2d8f-0e02-7f20-80b1-eeeeeeeeeee2";
const APPROVAL_ID = "018f2d8f-0e03-7f20-80b1-eeeeeeeeeee3";
const TOOL_CALL_ID = "018f2d8f-0e04-7f20-80b1-eeeeeeeeeee4";
const QUEUE_ID = "018f2d8f-0e05-7f20-80b1-eeeeeeeeeee5";

const CURRENT_CHECKPOINT = {
  piLeafId: "leaf-1",
  lastPersistedEntryId: "entry-1",
  lastProjectedEventId: "event-10",
  artifactIds: ["artifact-1"],
};

type CallLog = string[];

function deferred() {
  let resolve: () => void = () => {
    throw new Error("deferred promise is not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("deferred promise is not initialized");
  };
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeSessionManager() {
  return {
    getLeafId: vi.fn(() => "leaf-1"),
    getEntries: vi.fn(() => [{ id: "entry-1" }]),
  };
}

function makeAgentSession(calls: CallLog) {
  let toolExecutionAtPrompt: string | undefined;
  const session = {
    agent: { toolExecution: "parallel" as string },
    isIdle: true,
    subscribe: vi.fn((_listener: (event: { type: string }) => void) => {
      calls.push("subscribe");
      return () => {};
    }),
    bindExtensions: vi.fn(async (_bindings: Record<string, unknown>) => {
      calls.push("bindExtensions");
    }),
    prompt: vi.fn(async (_text: string, _options?: { expandPromptTemplates?: boolean }) => {
      toolExecutionAtPrompt = session.agent.toolExecution;
      calls.push("prompt");
    }),
    steer: vi.fn(async (_text: string) => {
      calls.push("steer");
      return "queued" as const;
    }),
    followUp: vi.fn(async (_text: string) => {
      calls.push("followUp");
      return "queued" as const;
    }),
    getSteeringMessages: vi.fn(() => ["steer while running"]),
    getFollowUpMessages: vi.fn(() => ["follow later"]),
    clearQueue: vi.fn(() => {
      calls.push("clearQueue");
      return { steering: ["steer while running"], followUp: ["follow later"] };
    }),
    abort: vi.fn(async () => {
      calls.push("abort");
    }),
  };
  return { session, toolExecutionAtPrompt: () => toolExecutionAtPrompt };
}

function makePiSdk(extensionErrors: Array<{ path: string; error: string }> = []) {
  const calls: CallLog = [];
  const manager = makeSessionManager();
  const { session, toolExecutionAtPrompt } = makeAgentSession(calls);
  const open = vi.fn((path: string, _sessionDir?: string, _cwdOverride?: string) => {
    calls.push(`open:${path}`);
    return manager;
  });
  const continueRecent = vi.fn((_cwd: string, _sessionDir?: string) => {
    calls.push("continueRecent");
    return manager;
  });
  const createAgentSession = vi.fn(
    async (_input: { cwd: string; sessionManager: typeof manager }) => {
      calls.push("createAgentSession");
      return {
        session,
        extensionsResult: { errors: extensionErrors },
      };
    },
  );
  const sdk = {
    SessionManager: { open, continueRecent },
    createAgentSession,
  };
  return {
    sdk,
    manager,
    session,
    calls,
    open,
    continueRecent,
    createAgentSession,
    toolExecutionAtPrompt: toolExecutionAtPrompt,
  };
}

function makeAdapter() {
  const calls: CallLog = [];
  const manager = makeSessionManager();
  const { session, toolExecutionAtPrompt } = makeAgentSession(calls);
  const persistQueueSnapshot = vi.fn(
    async (_snapshot: { steering: string[]; followUp: string[] }) => {
      calls.push("persistQueueSnapshot");
    },
  );
  const drainWrites = vi.fn(async () => {
    calls.push("drainWrites");
  });
  const adapter = createPiSessionAdapter({
    session,
    sessionManager: manager,
    queueStore: { persist: persistQueueSnapshot },
    writeChannel: { drain: drainWrites },
  });
  return {
    adapter,
    session,
    manager,
    calls,
    persistQueueSnapshot,
    drainWrites,
    toolExecutionAtPrompt: toolExecutionAtPrompt,
  };
}

describe("pi session registry", () => {
  it("opens the exact persisted session path and never continues the most recent session", async () => {
    const { sdk, manager, session, open, continueRecent, createAgentSession } = makePiSdk();

    const opened = await openWorkspaceSession({
      workspaceId: WORKSPACE_ID,
      cwd: CWD,
      sessionPath: SESSION_PATH,
      sessionDir: SESSION_DIR,
      approvalExtensionPath: APPROVAL_EXTENSION_PATH,
      sdk,
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe(SESSION_PATH);
    expect(continueRecent).not.toHaveBeenCalled();
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: CWD, sessionManager: manager }),
    );
    expect(opened.sessionManager).toBe(manager);
    expect(opened.session).toBe(session);
  });

  it("fails closed when the approval extension did not load", async () => {
    const { sdk, session } = makePiSdk([
      { path: APPROVAL_EXTENSION_PATH, error: "approval extension failed to load" },
    ]);

    await expect(
      openWorkspaceSession({
        workspaceId: WORKSPACE_ID,
        cwd: CWD,
        sessionPath: SESSION_PATH,
        sessionDir: SESSION_DIR,
        approvalExtensionPath: APPROVAL_EXTENSION_PATH,
        sdk,
      }),
    ).rejects.toMatchObject({ code: "extension_load_failed" });

    expect(session.subscribe).not.toHaveBeenCalled();
    expect(session.bindExtensions).not.toHaveBeenCalled();
    expect(session.prompt).not.toHaveBeenCalled();
  });
});

describe("pi session adapter", () => {
  it("subscribes, binds extensions, then prompts with sequential tools and expansion disabled", async () => {
    const { adapter, session, calls, toolExecutionAtPrompt } = makeAdapter();

    await adapter.start("Review the failing test");

    expect(calls).toEqual(["subscribe", "bindExtensions", "prompt"]);
    expect(session.subscribe).toHaveBeenCalledTimes(1);
    expect(session.bindExtensions).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledWith(
      "Review the failing test",
      expect.objectContaining({ expandPromptTemplates: false }),
    );
    expect(session.agent.toolExecution).toBe("sequential");
    expect(toolExecutionAtPrompt()).toBe("sequential");
  });

  it("uses steer and followUp as distinct commands and never substitutes prompt", async () => {
    const { adapter, session, calls } = makeAdapter();

    await adapter.steer("Focus on the failing assertion");
    await adapter.followUp("Then write a short summary");

    expect(calls).toEqual(["steer", "followUp"]);
    expect(session.steer).toHaveBeenCalledWith("Focus on the failing assertion");
    expect(session.followUp).toHaveBeenCalledWith("Then write a short summary");
    expect(session.steer).toHaveBeenCalledTimes(1);
    expect(session.followUp).toHaveBeenCalledTimes(1);
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it("persists the queue, clears it before aborting, drains writes and keeps every item withheld", async () => {
    const { adapter, session, calls, persistQueueSnapshot } = makeAdapter();

    const result = await adapter.stop();

    expect(calls).toEqual(["persistQueueSnapshot", "clearQueue", "abort", "drainWrites"]);
    expect(persistQueueSnapshot).toHaveBeenCalledWith({
      steering: ["steer while running"],
      followUp: ["follow later"],
    });
    expect(result.outcome).toBe("stopped");
    expect(result.queue).toEqual([
      { kind: "steer", body: "steer while running", status: "withheld" },
      { kind: "follow_up", body: "follow later", status: "withheld" },
    ]);
    expect(session.prompt).not.toHaveBeenCalled();
    expect(session.steer).not.toHaveBeenCalled();
    expect(session.followUp).not.toHaveBeenCalled();
  });

  it("does not advance the checkpoint until the write channel has drained", async () => {
    const { adapter, manager, calls, drainWrites } = makeAdapter();
    manager.getLeafId.mockReturnValue("leaf-2");
    manager.getEntries.mockReturnValue([{ id: "entry-1" }, { id: "entry-2" }]);

    const gate = deferred();
    drainWrites.mockImplementationOnce(() => {
      calls.push("drainWrites");
      return gate.promise;
    });

    const pending = adapter.checkpoint(CURRENT_CHECKPOINT);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.waitFor(() => expect(drainWrites).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    gate.resolve();
    const result = await pending;

    expect(result.advanced).toBe(true);
    expect(result.checkpoint).toMatchObject({
      piLeafId: "leaf-2",
      lastPersistedEntryId: "entry-2",
    });
  });

  it("leaves the checkpoint unchanged when the write drain fails", async () => {
    const { adapter, manager, drainWrites } = makeAdapter();
    manager.getLeafId.mockReturnValue("leaf-2");
    manager.getEntries.mockReturnValue([{ id: "entry-1" }, { id: "entry-2" }]);
    drainWrites.mockRejectedValueOnce(new Error("write channel closed"));

    await expect(adapter.checkpoint(CURRENT_CHECKPOINT)).rejects.toThrow("write channel closed");
  });
});

describe("pi recovery reconciliation", () => {
  it("marks a live run, its approvals and executing tools as needs_confirmation without replay", () => {
    const checkpoint = { ...CURRENT_CHECKPOINT };
    const result = reconcilePiSession({
      checkpoint,
      live: {
        run: { id: RUN_ID, state: "running" },
        approvals: [
          { id: APPROVAL_ID, state: "pending" },
          { id: "018f2d8f-0e06-7f20-80b1-eeeeeeeeeee6", state: "approved" },
        ],
        executingTools: [{ toolCallId: TOOL_CALL_ID, toolName: "write_file" }],
        queue: [{ id: QUEUE_ID, body: "finish after restart", kind: "follow_up" }],
      },
    });

    expect(result.run).toMatchObject({
      id: RUN_ID,
      state: "needs_confirmation",
      lastKnownState: "running",
      lastKnownCheckpoint: checkpoint,
    });
    expect(result.approvals.map((approval) => approval.state)).toEqual([
      "needs_confirmation",
      "needs_confirmation",
    ]);
    expect(result.executingTools[0]).toMatchObject({
      toolCallId: TOOL_CALL_ID,
      state: "needs_confirmation",
    });
    expect(result.queue[0]).toMatchObject({ id: QUEUE_ID, status: "withheld" });
    expect(result.autoReplay).toBe(false);
    for (const forbidden of [
      "execute_tool",
      "retry_tool",
      "resume_run",
      "auto_approve",
      "release_queue",
    ]) {
      expect(result.actions).not.toContain(forbidden);
    }
  });

  it("keeps a stopped queue withheld when the worker died after clearQueue but before abort", () => {
    const result = reconcilePiSession({
      checkpoint: { ...CURRENT_CHECKPOINT },
      live: {
        run: { id: RUN_ID, state: "stopping" },
        approvals: [{ id: APPROVAL_ID, state: "pending" }],
        executingTools: [],
        queue: [{ id: QUEUE_ID, body: "do not resume automatically", kind: "steer" }],
        stop: { requested: true, phase: "after_clear_queue_before_abort" },
      },
    });

    expect(result.run?.state).toBe("needs_confirmation");
    expect(result.queue[0]?.status).toBe("withheld");
    expect(result.autoReplay).toBe(false);
    expect(result.actions).not.toContain("resend_stop");
    expect(result.actions).not.toContain("release_queue");
  });

  it("does not rewrite a settled session or its final approval history", () => {
    const result = reconcilePiSession({
      checkpoint: { ...CURRENT_CHECKPOINT },
      live: {
        run: null,
        approvals: [{ id: APPROVAL_ID, state: "rejected" }],
        executingTools: [],
        queue: [],
      },
    });

    expect(result.run).toBeNull();
    expect(result.approvals).toEqual([{ id: APPROVAL_ID, state: "rejected" }]);
    expect(result.queue).toEqual([]);
    expect(result.autoReplay).toBe(false);
    expect(result.actions).toEqual([]);
  });
});
