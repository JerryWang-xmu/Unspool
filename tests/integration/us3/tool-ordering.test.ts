import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeAtInstructionBoundary,
  type ReleasedInstruction,
} from "../../../apps/execution-worker/src/instruction-boundary";
import { executeGuardedTool } from "../../../apps/execution-worker/src/tools/wrapper";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service";
import { RunsService } from "../../../apps/runner-api/src/runs/service";
import { computeActionDigest } from "../../../packages/domain/src/action-proposal";
import type { ApprovalGate } from "../../../packages/pi-adapter/src/approval-gate";
import { uuidv7 } from "../../../packages/security/src/uuid";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

describe("UAT-06 current-tool and queued-instruction ordering", () => {
  it("finishes the real read before applying steer and follow-up once in FIFO order", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-tool-ordering-"));
    directories.push(dataDir);
    const file = join(dataDir, "brief.txt");
    await writeFile(file, "long-tool-real-file-content");
    const opened = await openPersonalService({ dataDir });
    try {
      const ownerId = uuidv7();
      const created = await opened.service.createTask(
        ownerId,
        {
          name: "Tool ordering",
          goal: "Read then correct",
          completionCriteria: "Correction and follow-up apply only after the read",
          runnerId: uuidv7(),
          agentProfileId: uuidv7(),
          payloadDigest: digest("create"),
        },
        uuidv7(),
      );
      const workspaceId = String(created.response.workspace.id);
      const runs = new RunsService({ database: opened.database });
      const started = await runs.startRun(
        ownerId,
        workspaceId,
        { operatorEpoch: 1, body: "Start real read", payloadDigest: digest("start") },
        uuidv7(),
      );
      const runId = String(started.response.run.id);
      const action = { toolName: "read_file", canonicalArgs: { path: file }, target: file };
      const actionDigest = computeActionDigest(action);
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });
      let readFinished = false;
      const gate: ApprovalGate = {
        now: () => new Date(),
        authorize: async () => ({
          status: "authorized",
          effectiveArgsDigest: actionDigest,
          permit: {
            id: "readonly-test-seam",
            approvalDecisionId: "readonly-test",
            actionDigest,
            runAttemptId: "readonly-test",
            policyRevision: 0,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            consumedAt: new Date().toISOString(),
            consumptionResult: "outcome_unknown",
          },
        }),
        finalizePermit: async () => {},
      };
      const execution = executeGuardedTool({
        gate,
        approvalId: "readonly-test-seam",
        action,
        actionDigest,
        runAttemptId: "readonly-test",
        policyRevision: 0,
        invoke: async () => {
          entered();
          await blocker;
          const output = await readFile(file, "utf8");
          readFinished = true;
          return output;
        },
      });
      await enteredPromise;
      const steerInput = {
        operatorEpoch: 1,
        body: "Correct the direction after this read",
        payloadDigest: digest("steer"),
      };
      const followInput = {
        operatorEpoch: 1,
        body: "Handle the later instruction next",
        payloadDigest: digest("follow"),
      };
      await runs.enqueue(ownerId, workspaceId, runId, "steer", steerInput, uuidv7());
      await runs.enqueue(ownerId, workspaceId, runId, "follow_up", followInput, uuidv7());
      expect(readFinished).toBe(false);
      release();
      const completed = await execution;
      expect(completed.status).toBe("succeeded");
      expect(readFinished).toBe(true);
      if (completed.status === "succeeded")
        expect(completed.result).toBe("long-tool-real-file-content");

      const applied: string[] = [];
      const apply = (instruction: ReleasedInstruction) => {
        applied.push(`${instruction.kind}:${instruction.body}`);
      };
      const first = await executeAtInstructionBoundary({
        consume: () => runs.consumeNextInstruction(ownerId, workspaceId, runId, 1),
        apply,
      });
      const second = await executeAtInstructionBoundary({
        consume: () => runs.consumeNextInstruction(ownerId, workspaceId, runId, 1),
        apply,
      });
      const third = await executeAtInstructionBoundary({
        consume: () => runs.consumeNextInstruction(ownerId, workspaceId, runId, 1),
        apply,
      });
      expect(first.state).toBe("applied");
      expect(second.state).toBe("applied");
      expect(third.state).toBe("idle");
      expect(applied).toEqual([`steer:${steerInput.body}`, `follow_up:${followInput.body}`]);
      const detail = await runs.getRun(ownerId, workspaceId, runId);
      const events = detail.run.events as { type: string }[];
      expect(events.filter((event) => event.type === "run.queue_released")).toHaveLength(2);
      expect(events.findIndex((event) => event.type === "run.steer_queued")).toBeLessThan(
        events.findIndex((event) => event.type === "run.follow_up_queued"),
      );
    } finally {
      await opened.close();
    }
  });
});
