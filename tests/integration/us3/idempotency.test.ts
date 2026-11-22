/**
 * T117 / US3 / QS-03.3 / TO-04.
 *
 * RED integration coverage for lost-response recovery and concurrency fences.
 * Planned surfaces:
 *   - apps/runner-api/src/commands/idempotency.ts (T123)
 *   - apps/runner-api/src/runs/service.ts (T072)
 *
 * Idempotency contract: the first committed result is authoritative. A retry
 * with the same key and payload returns that result without calling execute();
 * the same key with a different payload is a revision conflict; an outcome
 * already marked unknown is never executed again.
 */
import { describe, expect, it } from "vitest";
import { createCommandIdempotencyService } from "../../../apps/runner-api/src/commands/idempotency";
import { createRunService } from "../../../apps/runner-api/src/runs/service";

const WORKSPACE_ID = "018f2d8f-0c01-7f20-80b1-cccccccccc01";
const OTHER_WORKSPACE_ID = "018f2d8f-0c02-7f20-80b1-cccccccccc02";
const OPERATOR_ID = "018f2d8f-0c03-7f20-80b1-cccccccccc03";
const SECOND_OPERATOR_ID = "018f2d8f-0c04-7f20-80b1-cccccccccc04";
const THIRD_OPERATOR_ID = "018f2d8f-0c05-7f20-80b1-cccccccccc05";
const COMMAND_ID = "018f2d8f-0c06-7f20-80b1-cccccccccc06";
const OTHER_COMMAND_ID = "018f2d8f-0c07-7f20-80b1-cccccccccc07";
const KEY = "018f2d8f-0c08-7f20-80b1-cccccccccc08";
const OTHER_KEY = "018f2d8f-0c09-7f20-80b1-cccccccccc09";
const DIGEST = `sha256:${"c".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"d".repeat(64)}`;
const NOW = new Date("2026-11-22T10:00:00.000Z");

function makeIdempotency() {
  return createCommandIdempotencyService({ now: () => NOW });
}

async function runCommand(
  service: ReturnType<typeof makeIdempotency>,
  options: {
    key?: string;
    commandId?: string;
    digest?: string;
    execute?: () => Promise<{ state: "succeeded" | "outcome_unknown"; result?: unknown }>;
  } = {},
) {
  return service.execute({
    idempotencyKey: options.key ?? KEY,
    commandId: options.commandId ?? COMMAND_ID,
    payloadDigest: options.digest ?? DIGEST,
    execute: options.execute ?? (async () => ({ state: "succeeded", result: { applied: true } })),
  });
}

describe("lost-response idempotency", () => {
  it("replays the first known result when the client response was lost", async () => {
    const service = makeIdempotency();
    let executions = 0;

    const first = await runCommand(service, {
      execute: async () => {
        executions += 1;
        return { state: "succeeded", result: { externalSideEffects: 1, value: "accepted" } };
      },
    });
    expect(first.ok).toBe(true);
    expect(first.replayed).toBe(false);
    expect(first.receipt.state).toBe("succeeded");

    // The client never saw the first response and retries with the same key.
    const retry = await runCommand(service, {
      execute: async () => {
        executions += 1;
        return { state: "succeeded", result: { externalSideEffects: 2 } };
      },
    });

    expect(retry.ok).toBe(true);
    expect(retry.replayed).toBe(true);
    expect(retry.receipt.result).toEqual(first.receipt.result);
    expect(executions).toBe(1);
  });

  it("returns the same logical result after the response is lost and the page is refreshed", async () => {
    const service = makeIdempotency();
    let executions = 0;
    const command = () => ({
      idempotencyKey: KEY,
      commandId: COMMAND_ID,
      payloadDigest: DIGEST,
      execute: async () => {
        executions += 1;
        return { state: "succeeded" as const, result: { runId: "run-1", accepted: true } };
      },
    });

    expect((await service.execute(command())).ok).toBe(true);
    // A new request object after refresh must still resolve by the stored key.
    const refreshed = await service.execute(command());

    expect(refreshed.ok).toBe(true);
    expect(refreshed.replayed).toBe(true);
    expect(refreshed.receipt.result).toEqual({ runId: "run-1", accepted: true });
    expect(executions).toBe(1);
  });

  it("rejects the same key with a different payload without executing it", async () => {
    const service = makeIdempotency();
    let executions = 0;
    const first = await runCommand(service, {
      execute: async () => {
        executions += 1;
        return { state: "succeeded", result: { applied: true } };
      },
    });
    expect(first.ok).toBe(true);

    const conflict = await runCommand(service, {
      commandId: OTHER_COMMAND_ID,
      digest: OTHER_DIGEST,
      execute: async () => {
        executions += 1;
        return { state: "succeeded", result: { applied: "second" } };
      },
    });

    expect(conflict.ok).toBe(false);
    expect(conflict.code).toBe("revision_conflict");
    expect(executions).toBe(1);
  });

  it("never re-executes a command whose result is already unknown", async () => {
    const service = makeIdempotency();
    let executions = 0;

    const first = await runCommand(service, {
      execute: async () => {
        executions += 1;
        return { state: "outcome_unknown", result: { externalSideEffects: 1 } };
      },
    });
    expect(first.ok).toBe(true);
    expect(first.receipt.state).toBe("outcome_unknown");

    const retry = await runCommand(service, {
      execute: async () => {
        executions += 1;
        return { state: "succeeded", result: { externalSideEffects: 2 } };
      },
    });

    expect(retry.ok).toBe(true);
    expect(retry.replayed).toBe(true);
    expect(retry.receipt.state).toBe("outcome_unknown");
    expect(retry.receipt.result).toEqual({ externalSideEffects: 1 });
    expect(executions).toBe(1);
  });

  it("does not commit a receipt when execution fails before acceptance, so the same key may retry", async () => {
    const service = makeIdempotency();
    let executions = 0;

    await expect(
      runCommand(service, {
        execute: async () => {
          executions += 1;
          throw new Error("runner crashed before accepting the command");
        },
      }),
    ).rejects.toThrow(/before accepting/);

    const retry = await runCommand(service, {
      execute: async () => {
        executions += 1;
        return { state: "succeeded", result: { accepted: true } };
      },
    });

    expect(retry.ok).toBe(true);
    expect(retry.replayed).toBe(false);
    expect(executions).toBe(2);
  });

  it("serializes concurrent commands that share one key and executes only once", async () => {
    const service = makeIdempotency();
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execute = async () => {
      executions += 1;
      await gate;
      return { state: "succeeded" as const, result: { value: "one" } };
    };

    const first = runCommand(service, { execute });
    const second = runCommand(service, { execute });
    await Promise.resolve();
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(executions).toBe(1);
    expect(a.receipt.result).toEqual(b.receipt.result);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
  });

  it("keeps distinct keys independent", async () => {
    const service = makeIdempotency();
    let executions = 0;
    const execute = async () => {
      executions += 1;
      return { state: "succeeded" as const, result: { applied: executions } };
    };

    const [a, b] = await Promise.all([
      runCommand(service, { key: KEY, execute }),
      runCommand(service, {
        key: OTHER_KEY,
        commandId: OTHER_COMMAND_ID,
        digest: OTHER_DIGEST,
        execute,
      }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(executions).toBe(2);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
  });
});

describe("concurrent start and takeover fences", () => {
  function makeRuns() {
    return createRunService({ now: () => NOW });
  }

  function start(
    runs: ReturnType<typeof makeRuns>,
    options: {
      workspaceId?: string;
      actorId?: string;
      operatorEpoch?: number;
      key?: string;
      commandId?: string;
      digest?: string;
    } = {},
  ) {
    return runs.start({
      workspaceId: options.workspaceId ?? WORKSPACE_ID,
      actorId: options.actorId ?? OPERATOR_ID,
      operatorEpoch: options.operatorEpoch ?? 1,
      idempotencyKey: options.key ?? KEY,
      commandId: options.commandId ?? COMMAND_ID,
      payloadDigest: options.digest ?? DIGEST,
    });
  }

  it("admits only one active run when two different start keys race", async () => {
    const runs = makeRuns();
    const [a, b] = await Promise.all([
      start(runs, { key: KEY, commandId: COMMAND_ID }),
      start(runs, { key: OTHER_KEY, commandId: OTHER_COMMAND_ID }),
    ]);

    expect([a, b].filter((result) => result.ok)).toHaveLength(1);
    const loser = [a, b].find((result) => !result.ok);
    expect(loser && "code" in loser ? loser.code : undefined).toBe("task_active");
  });

  it("returns the same run when the same start key is retried after a lost response", async () => {
    const runs = makeRuns();
    const first = await start(runs);
    expect(first.ok).toBe(true);

    const retry = await start(runs);
    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.runId).toBe(first.runId);
      expect(retry.replayed).toBe(true);
    }
  });

  it("returns one logical run to two concurrent requests that share a start key", async () => {
    const runs = makeRuns();
    const [a, b] = await Promise.all([start(runs), start(runs)]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.runId).toBe(b.runId);
    }
  });

  it("lets only one operator win a takeover of the same epoch", async () => {
    const runs = makeRuns();
    const started = await start(runs);
    expect(started.ok).toBe(true);
    const epoch = started.ok ? started.operatorEpoch : 1;

    const [second, third] = await Promise.all([
      runs.takeOver({
        workspaceId: WORKSPACE_ID,
        actorId: SECOND_OPERATOR_ID,
        expectedOperatorEpoch: epoch,
        reason: "Shift change",
      }),
      runs.takeOver({
        workspaceId: WORKSPACE_ID,
        actorId: THIRD_OPERATOR_ID,
        expectedOperatorEpoch: epoch,
        reason: "Shift change",
      }),
    ]);

    expect([second, third].filter((result) => result.ok)).toHaveLength(1);
    const loser = [second, third].find((result) => !result.ok);
    expect(loser && "code" in loser ? loser.code : undefined).toMatch(
      /operator_changed|takeover_conflict/,
    );
  });

  it("rejects a stale operator epoch after another operator took over", async () => {
    const runs = makeRuns();
    const started = await start(runs);
    expect(started.ok).toBe(true);
    const epoch = started.ok ? started.operatorEpoch : 1;

    const takeover = await runs.takeOver({
      workspaceId: WORKSPACE_ID,
      actorId: SECOND_OPERATOR_ID,
      expectedOperatorEpoch: epoch,
      reason: "Shift change",
    });
    expect(takeover.ok).toBe(true);

    const stale = await start(runs, {
      workspaceId: WORKSPACE_ID,
      actorId: OPERATOR_ID,
      operatorEpoch: epoch,
      key: OTHER_KEY,
      commandId: OTHER_COMMAND_ID,
      digest: OTHER_DIGEST,
    });

    expect(stale.ok).toBe(false);
    expect(stale.code).toBe("operator_changed");
  });

  it("does not import another workspace's start key", async () => {
    const runs = makeRuns();
    const first = await start(runs, { workspaceId: WORKSPACE_ID });
    const other = await start(runs, {
      workspaceId: OTHER_WORKSPACE_ID,
      key: KEY,
      commandId: COMMAND_ID,
    });

    expect(first.ok).toBe(true);
    expect(other.ok).toBe(true);
    if (first.ok && other.ok) {
      expect(other.runId).not.toBe(first.runId);
    }
  });
});
