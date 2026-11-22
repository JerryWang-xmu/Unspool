import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalRequest } from "../../../apps/runner-api/src/approvals/service.js";
import { createSqliteApprovalStore } from "../../../apps/runner-api/src/approvals/store.js";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service.js";
import { RunsService } from "../../../apps/runner-api/src/runs/service.js";
import { createActionProposal } from "../../../packages/domain/src/action-proposal.js";
import { createApprovalDecision } from "../../../packages/domain/src/approval-decision.js";
import { uuidv7 } from "../../../packages/security/src/uuid.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("approval persistence races", () => {
  it("allows exactly one terminal decision for a pending request", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-approval-race-"));
    directories.push(dataDir);
    const ownerId = uuidv7();
    const opened = await openPersonalService({ dataDir });
    try {
      const created = await opened.service.createTask(
        ownerId,
        {
          name: "Approval race",
          goal: "One decision",
          completionCriteria: "No conflicting decisions",
          runnerId: uuidv7(),
          agentProfileId: uuidv7(),
          payloadDigest: `sha256:${"a".repeat(64)}`,
        },
        uuidv7(),
      );
      const workspaceId = String(created.response.workspace.id);
      const runs = new RunsService({ database: opened.database });
      const started = await runs.startRun(
        ownerId,
        workspaceId,
        { operatorEpoch: 1, body: "approval race", payloadDigest: `sha256:${"b".repeat(64)}` },
        uuidv7(),
      );
      const runId = String(started.response.run.id);
      const attemptId = uuidv7();
      const toolCallId = uuidv7();
      const now = new Date("2026-11-22T10:00:00.000Z");
      await opened.database.execute(
        "INSERT INTO run_attempt (id, run_id, worker_id, attempt_epoch, state, lease_expires_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [attemptId, runId, "worker", 1, "running", "2026-11-22T11:00:00.000Z", now.toISOString()],
      );
      await opened.database.execute(
        "INSERT INTO tool_call_record (id, run_attempt_id, tool_call_id, tool_name, original_args_digest, effective_args_digest, state, preflight_at) VALUES (?, ?, ?, ?, ?, ?, 'waiting_approval', ?)",
        [
          toolCallId,
          attemptId,
          toolCallId,
          "write_file",
          `sha256:${"c".repeat(64)}`,
          `sha256:${"c".repeat(64)}`,
          now.toISOString(),
        ],
      );
      const createdApproval = createApprovalRequest({
        id: uuidv7(),
        actionProposalId: uuidv7(),
        requesterId: ownerId,
        action: { toolName: "write_file", canonicalArgs: { path: "canary.txt" } },
        purpose: "Race test",
        impact: "One file",
        risk: "high",
        displayArgs: { path: "canary.txt" },
        secretRefs: [],
        policyRevision: 1,
        now,
        requiredApproverPolicy: { approverIds: [ownerId], allowRequesterSelfApproval: true },
        runId,
        attemptId,
        toolCallId,
      });
      const store = createSqliteApprovalStore(opened.database);
      await store.save(createdApproval);
      const firstDecision = createApprovalDecision({
        id: uuidv7(),
        approvalRequestId: createdApproval.request.id,
        decision: "approved",
        decidedBy: ownerId,
        decidedAt: now,
        actionDigest: createdApproval.proposal.actionDigest,
      });
      const secondDecision = createApprovalDecision({
        id: uuidv7(),
        approvalRequestId: createdApproval.request.id,
        decision: "rejected",
        decidedBy: ownerId,
        decidedAt: now,
        actionDigest: createdApproval.proposal.actionDigest,
      });
      const results = await Promise.allSettled([
        store.decidePending({
          request: { ...createdApproval.request, state: "approved" },
          proposal: createdApproval.proposal,
          decision: firstDecision,
        }),
        store.decidePending({
          request: { ...createdApproval.request, state: "rejected" },
          proposal: createdApproval.proposal,
          decision: secondDecision,
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const decisions = await opened.database.query(
        "SELECT * FROM approval_decision WHERE approval_request_id = ?",
        [createdApproval.request.id],
      );
      expect(decisions).toHaveLength(1);
      const request = await store.get(createdApproval.request.id);
      expect(request?.request.state).toBe("approved");
    } finally {
      await opened.close();
    }
  });
});
