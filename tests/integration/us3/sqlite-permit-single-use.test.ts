/**
 * Production SQLite boundary for the execution permit: one consumed permit can
 * authorize at most one tool invocation, two gate instances cannot both win,
 * and an unknown outcome can never be replayed. Migration 64 allows only the
 * single audit transition from outcome_unknown to a final outcome.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeGuardedTool } from "../../../apps/execution-worker/src/tools/wrapper";
import {
  consumeExecutionPermitAtomic,
  finalizeExecutionPermitOutcome,
  issueExecutionPermit,
} from "../../../apps/runner-api/src/approvals/permit-service";
import {
  createApprovalRequest,
  decideApproval,
} from "../../../apps/runner-api/src/approvals/service";
import { createSqliteApprovalGate } from "../../../apps/runner-api/src/approvals/sqlite-gate";
import { createSqliteApprovalStore } from "../../../apps/runner-api/src/approvals/store";
import {
  type ActionEnvelope,
  computeActionDigest,
} from "../../../packages/domain/src/action-proposal";
import type { ExecutionPermit } from "../../../packages/domain/src/execution-permit";
import { openDatabase, type SqliteDatabase } from "../../../packages/persistence/src/database";
import { foundationMigrations, runMigrations } from "../../../packages/persistence/src/migrations";

const REQUESTER_ID = "user-requester";
const APPROVER_ID = "user-approver";
const WORKSPACE_ID = "workspace-1";
const RUNNER_ID = "runner-1";
const CONVERSATION_ID = "conversation-1";
const RUN_ID = "run-1";
const CONTEXT_ID = "context-1";
const ATTEMPT_ID = "attempt-1";
const TOOL_CALL_ID = "tool-call-1";
const REQUEST_ID = "request-1";
const PROPOSAL_ID = "proposal-1";
const DECISION_ID = "decision-1";
const PERMIT_ID = "permit-1";
const POLICY_REVISION = 7;
const BASE_TIME = new Date("2026-11-22T10:00:00.000Z");

const ACTION: ActionEnvelope = {
  toolName: "write_file",
  canonicalArgs: { path: "report.md", content: "approved body" },
  workingDirectory: "/workspace",
  target: "report.md",
  recipients: ["team:unspool"],
  baseResourceVersions: [{ id: "report.md", version: "1" }],
};

const INDEPENDENT_APPROVER = {
  approverIds: [APPROVER_ID],
  allowRequesterSelfApproval: false,
};

interface SeededApproval {
  readonly requestId: string;
  readonly actionDigest: string;
  readonly permit: ExecutionPermit;
}

const directories: string[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createCanonicalDatabase(): Promise<{
  database: SqliteDatabase;
  filename: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "unspool-us3-permit-"));
  directories.push(directory);
  const filename = join(directory, "unspool.sqlite");
  const database = await openDatabase({ filename });
  databases.push(database);
  await runMigrations(database, foundationMigrations);
  return { database, filename };
}

async function seedPrerequisites(database: SqliteDatabase): Promise<void> {
  const now = BASE_TIME.toISOString();
  const actionDigest = computeActionDigest(ACTION);

  await database.execute("PRAGMA defer_foreign_keys = ON");
  await database.write(async (transaction) => {
    await transaction.execute(
      `INSERT INTO user (id, display_name, status, auth_version, created_at, disabled_at)
       VALUES (?, ?, 'active', 1, ?, NULL)`,
      [REQUESTER_ID, "Requester", now],
    );
    await transaction.execute(
      `INSERT INTO runner (id, team_id, name, purpose, status, version, capabilities, policy_revision, last_heartbeat_at)
       VALUES (?, NULL, ?, ?, 'available', ?, '[]', ?, ?)`,
      [RUNNER_ID, "Local runner", "Execution", "1.0.0", POLICY_REVISION, now],
    );
    await transaction.execute(
      `INSERT INTO workspace (id, kind, team_id, owner_id, runner_id, name, goal, completion_criteria, status, visibility, agent_config_snapshot, federation_mode, revision, created_at, archived_at)
       VALUES (?, 'personal', NULL, ?, ?, ?, '', '', 'draft', 'owner_private', '{}', 'disabled', 0, ?, NULL)`,
      [WORKSPACE_ID, REQUESTER_ID, RUNNER_ID, "Approval test", now],
    );
    await transaction.execute(
      `INSERT INTO agent_conversation (id, workspace_id, pi_session_ref, session_format_version, continuation_of_id, created_at)
       VALUES (?, ?, ?, 1, NULL, ?)`,
      [CONVERSATION_ID, WORKSPACE_ID, "pi-session-1", now],
    );
    await transaction.execute(
      `INSERT INTO run (id, workspace_id, conversation_id, sequence, state, operator_epoch, runner_id, context_snapshot_id, started_by, started_at, ended_at, last_known_checkpoint)
       VALUES (?, ?, ?, 1, 'running', 1, ?, ?, ?, ?, NULL, NULL)`,
      [RUN_ID, WORKSPACE_ID, CONVERSATION_ID, RUNNER_ID, CONTEXT_ID, REQUESTER_ID, now],
    );
    await transaction.execute(
      `INSERT INTO task_context_snapshot (id, run_id, context_version_ids, rendered_digest, created_at)
       VALUES (?, ?, '[]', ?, ?)`,
      [CONTEXT_ID, RUN_ID, actionDigest, now],
    );
    await transaction.execute(
      `INSERT INTO run_attempt (id, run_id, worker_id, attempt_epoch, state, lease_expires_at, started_at, settled_at, unknown_reason)
       VALUES (?, ?, ?, 1, 'running', ?, ?, NULL, NULL)`,
      [ATTEMPT_ID, RUN_ID, "worker-1", new Date(BASE_TIME.getTime() + 60_000).toISOString(), now],
    );
    await transaction.execute(
      `INSERT INTO tool_call_record (id, run_attempt_id, tool_call_id, parent_tool_call_id, tool_name, original_args_digest, effective_args_digest, state, preflight_at, execution_entered_at, finalized_at, result_digest, transcript_entry_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 'preflight', ?, NULL, NULL, NULL, NULL)`,
      [TOOL_CALL_ID, ATTEMPT_ID, TOOL_CALL_ID, ACTION.toolName, actionDigest, actionDigest, now],
    );
  });
}

async function seedApproval(database: SqliteDatabase): Promise<SeededApproval> {
  await seedPrerequisites(database);

  const created = createApprovalRequest({
    id: REQUEST_ID,
    actionProposalId: PROPOSAL_ID,
    requesterId: REQUESTER_ID,
    action: ACTION,
    purpose: "Write the reviewed report",
    impact: "Overwrite exactly one report file",
    risk: "high",
    displayArgs: { path: "report.md" },
    secretRefs: [],
    policyRevision: POLICY_REVISION,
    now: BASE_TIME,
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    toolCallId: TOOL_CALL_ID,
  });

  const store = createSqliteApprovalStore(database);
  await store.save(created);

  const decided = decideApproval({
    id: DECISION_ID,
    request: created.request,
    proposal: created.proposal,
    actorId: APPROVER_ID,
    decision: "approved",
    actionDigest: created.proposal.actionDigest,
    now: BASE_TIME,
    approverPolicy: INDEPENDENT_APPROVER,
  });
  if (decided.decision === undefined || decided.audit === undefined) {
    throw new Error("Fixture approval could not be decided");
  }
  await store.decidePending({
    request: decided.request,
    proposal: decided.proposal,
    decision: decided.decision,
    audit: decided.audit,
  });

  const issued = issueExecutionPermit({
    id: PERMIT_ID,
    request: decided.request,
    proposal: decided.proposal,
    decision: decided.decision,
    runAttemptId: ATTEMPT_ID,
    policyRevision: POLICY_REVISION,
    now: BASE_TIME,
  });
  if (issued.permit === undefined) {
    throw new Error("Fixture execution permit could not be issued");
  }
  await database.execute(
    `INSERT INTO execution_permit (id, approval_decision_id, action_digest, run_attempt_id, policy_revision, expires_at, consumed_at, consumption_result)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      issued.permit.id,
      issued.permit.approvalDecisionId,
      issued.permit.actionDigest,
      issued.permit.runAttemptId,
      issued.permit.policyRevision,
      issued.permit.expiresAt,
    ],
  );

  return {
    requestId: decided.request.id,
    actionDigest: decided.proposal.actionDigest,
    permit: issued.permit,
  };
}

async function openSecondInstance(filename: string): Promise<SqliteDatabase> {
  const database = await openDatabase({ filename });
  databases.push(database);
  return database;
}

describe("SQLite execution-permit single use", () => {
  it("allows exactly one tool invocation across two gate instances", async () => {
    const { database, filename } = await createCanonicalDatabase();
    const seeded = await seedApproval(database);
    const secondDatabase = await openSecondInstance(filename);
    const gateA = createSqliteApprovalGate(database, { now: () => BASE_TIME });
    const gateB = createSqliteApprovalGate(secondDatabase, { now: () => BASE_TIME });

    let invocations = 0;
    const request = {
      approvalId: seeded.requestId,
      action: ACTION,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
    };

    const results = await Promise.all([
      executeGuardedTool({
        gate: gateA,
        ...request,
        invoke: async () => {
          invocations += 1;
          return "first";
        },
      }),
      executeGuardedTool({
        gate: gateB,
        ...request,
        invoke: async () => {
          invocations += 1;
          return "second";
        },
      }),
    ]);

    expect(invocations).toBe(1);
    expect(results.filter((result) => result.status === "succeeded")).toHaveLength(1);
    const blocked = results.find((result) => result.status === "blocked");
    expect(blocked?.status).toBe("blocked");
    if (blocked?.status === "blocked") {
      expect(blocked.code, blocked.reason).toBe("already_consumed");
    }

    const rows = await database.query<{
      consumed_at: string | null;
      consumption_result: string | null;
    }>("SELECT consumed_at, consumption_result FROM execution_permit WHERE id = ?", [PERMIT_ID]);
    expect(rows[0]?.consumed_at).toBe(BASE_TIME.toISOString());
    expect(rows[0]?.consumption_result).toBe("succeeded");
  });

  it("keeps an unknown outcome non-replayable across gate instances", async () => {
    const { database, filename } = await createCanonicalDatabase();
    const seeded = await seedApproval(database);
    const secondDatabase = await openSecondInstance(filename);
    const gateA = createSqliteApprovalGate(database, { now: () => BASE_TIME });
    const gateB = createSqliteApprovalGate(secondDatabase, { now: () => BASE_TIME });

    let invocations = 0;
    const lost = await executeGuardedTool({
      gate: gateA,
      approvalId: seeded.requestId,
      action: ACTION,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      simulateResponseLoss: true,
      invoke: async () => {
        invocations += 1;
        return "side effect committed";
      },
    });

    expect(lost.status).toBe("outcome_unknown");
    expect(invocations).toBe(1);

    const rows = await database.query<{ consumption_result: string | null }>(
      "SELECT consumption_result FROM execution_permit WHERE id = ?",
      [PERMIT_ID],
    );
    expect(rows[0]?.consumption_result).toBe("outcome_unknown");

    const retry = await executeGuardedTool({
      gate: gateB,
      approvalId: seeded.requestId,
      action: ACTION,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      invoke: async () => {
        invocations += 1;
        return "must not run";
      },
    });

    expect(retry.status).toBe("blocked");
    if (retry.status === "blocked") {
      expect(retry.code).toBe("already_consumed");
      expect(retry.reason).toMatch(/unknown/i);
    }
    expect(invocations).toBe(1);

    const replay = await consumeExecutionPermitAtomic(database, {
      permit: seeded.permit,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: BASE_TIME,
      consumptionResult: "outcome_unknown",
    });
    expect(replay.status).toBe("rejected");
    expect(replay.error?.code).toBe("outcome_unknown");
  });

  it("allows one unknown-to-final transition and freezes consumption", async () => {
    const { database } = await createCanonicalDatabase();
    const seeded = await seedApproval(database);

    const consumed = await consumeExecutionPermitAtomic(database, {
      permit: seeded.permit,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: BASE_TIME,
      consumptionResult: "outcome_unknown",
    });
    expect(consumed.status).toBe("consumed");
    expect(consumed.permit.consumedAt).toBe(BASE_TIME.toISOString());

    await expect(
      database.execute("UPDATE execution_permit SET consumed_at = ? WHERE id = ?", [
        new Date(BASE_TIME.getTime() + 1_000).toISOString(),
        PERMIT_ID,
      ]),
    ).rejects.toThrow(/execution_permit_already_consumed/);
    await expect(
      database.execute(
        "UPDATE execution_permit SET consumed_at = NULL, consumption_result = NULL WHERE id = ?",
        [PERMIT_ID],
      ),
    ).rejects.toThrow(/execution_permit_already_consumed/);

    await finalizeExecutionPermitOutcome(database, {
      ...consumed.permit,
      consumptionResult: "succeeded",
    });

    const finalized = await database.query<{
      consumed_at: string | null;
      consumption_result: string | null;
    }>("SELECT consumed_at, consumption_result FROM execution_permit WHERE id = ?", [PERMIT_ID]);
    expect(finalized[0]?.consumed_at).toBe(BASE_TIME.toISOString());
    expect(finalized[0]?.consumption_result).toBe("succeeded");

    await expect(
      finalizeExecutionPermitOutcome(database, {
        ...consumed.permit,
        consumptionResult: "failed",
      }),
    ).rejects.toThrow(/already final/i);
    await expect(
      database.execute("UPDATE execution_permit SET consumption_result = 'failed' WHERE id = ?", [
        PERMIT_ID,
      ]),
    ).rejects.toThrow(/execution_permit_already_consumed/);
    await expect(
      database.execute("UPDATE execution_permit SET consumption_result = NULL WHERE id = ?", [
        PERMIT_ID,
      ]),
    ).rejects.toThrow(/execution_permit_already_consumed/);
  });

  it("does not share one authorization across same-gate concurrent invocations", async () => {
    const { database } = await createCanonicalDatabase();
    const seeded = await seedApproval(database);
    const gate = createSqliteApprovalGate(database, { now: () => BASE_TIME });
    let invocations = 0;
    const request = {
      approvalId: seeded.requestId,
      action: ACTION,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
    };
    const results = await Promise.all([
      executeGuardedTool({
        gate,
        ...request,
        invoke: () => {
          invocations += 1;
          return "one";
        },
      }),
      executeGuardedTool({
        gate,
        ...request,
        invoke: () => {
          invocations += 1;
          return "replay";
        },
      }),
    ]);
    expect(invocations).toBe(1);
    expect(results.filter((result) => result.status === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.status === "blocked")).toHaveLength(1);
  });

  it("independently rejects mismatched attempt and policy on a shared gate", async () => {
    const { database } = await createCanonicalDatabase();
    const seeded = await seedApproval(database);
    const gate = createSqliteApprovalGate(database, { now: () => BASE_TIME });
    let invocations = 0;
    const valid = {
      approvalId: seeded.requestId,
      action: ACTION,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
    };
    const invoke = () => {
      invocations += 1;
      return "authorized-once";
    };
    const results = await Promise.all([
      executeGuardedTool({ gate, ...valid, invoke }),
      executeGuardedTool({ gate, ...valid, runAttemptId: "another-attempt", invoke }),
      executeGuardedTool({ gate, ...valid, policyRevision: POLICY_REVISION + 1, invoke }),
    ]);
    expect(invocations).toBe(1);
    expect(results.filter((result) => result.status === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.status === "blocked")).toHaveLength(2);
  });

  it("revalidates invalidation in the same transaction as permit consumption", async () => {
    const { database } = await createCanonicalDatabase();
    const seeded = await seedApproval(database);
    let invocations = 0;
    const gate = createSqliteApprovalGate(database, {
      now: () => BASE_TIME,
      beforeConsume: async () => {
        await database.execute("UPDATE approval_request SET state = 'invalidated' WHERE id = ?", [
          seeded.requestId,
        ]);
      },
    });
    const result = await executeGuardedTool({
      gate,
      approvalId: seeded.requestId,
      action: ACTION,
      actionDigest: seeded.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      invoke: () => {
        invocations += 1;
        return "must not execute";
      },
    });
    expect(result.status).toBe("blocked");
    expect(invocations).toBe(0);
    const persisted = await database.query<{ consumed_at: string | null }>(
      "SELECT consumed_at FROM execution_permit WHERE id = ?",
      [PERMIT_ID],
    );
    expect(persisted[0]?.consumed_at).toBeNull();
  });
});
