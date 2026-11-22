import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { executeGuardedTool } from "../apps/runner-api/dist/apps/runner-api/src/approvals/execution.js";
import {
  createApprovalRequest,
  issueExecutionPermit,
} from "../apps/runner-api/dist/apps/runner-api/src/approvals/service.js";
import { createSqliteApprovalGate } from "../apps/runner-api/dist/apps/runner-api/src/approvals/sqlite-gate.js";
import { createSqliteApprovalStore } from "../apps/runner-api/dist/apps/runner-api/src/approvals/store.js";
import { createArtifactService } from "../apps/runner-api/dist/apps/runner-api/src/artifacts/service.js";
import { buildServer } from "../apps/runner-api/dist/apps/runner-api/src/index.js";
import { openDatabase } from "../apps/runner-api/dist/packages/persistence/src/database.js";
import { uuidv7 } from "../apps/runner-api/dist/packages/security/src/uuid.js";

const dataDir = resolve(process.env.UNSPOOL_DATA_DIR ?? "");
const canaryPath = resolve(process.env.UNSPOOL_E2E_US1_CANARY_PATH ?? "");
const marker = process.env.UNSPOOL_E2E_US1_WRITE_MARKER;
const artifactName = process.env.UNSPOOL_E2E_US1_ARTIFACT_NAME;
const port = Number(process.env.UNSPOOL_VALIDATION_PORT ?? "8788");
if (
  !dataDir.includes("validation") ||
  (!canaryPath.startsWith(`${dataDir}\\`) && !canaryPath.startsWith(`${dataDir}/`))
)
  throw new Error("US1 validation requires a dedicated dataDir and contained canary");
if (!marker || !artifactName) throw new Error("US1 marker and artifact name are required");
const ownerToken = "validation-us2-us4-owner";
const database = await openDatabase({ filename: resolve(dataDir, "unspool.sqlite") });
const store = createSqliteApprovalStore(database);
const artifacts = createArtifactService({ database, dataDir });

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
async function appendEvent({ workspaceId, runId, actorId, type, payload }) {
  const id = uuidv7();
  const occurredAt = new Date().toISOString();
  const payloadDigest = digest(payload);
  await database.write(async (transaction) => {
    await transaction.execute(
      `INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload)
      VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspaceId,
        workspaceId,
        type,
        actorId,
        runId,
        occurredAt,
        JSON.stringify({ kind: "owner_private" }),
        `event:${id}`,
        payloadDigest,
        JSON.stringify(payload),
      ],
    );
    await transaction.execute(
      "INSERT INTO outbox_message (id, domain_event_id, destination, state, attempt_count, available_at, created_at) VALUES (?, ?, 'domain-events', 'pending', 0, ?, ?)",
      [uuidv7(), id, occurredAt, occurredAt],
    );
  });
}
async function proposeWrite(run, attemptId) {
  const ownerId = run.owner_id;
  const approvalId = uuidv7();
  const toolCallId = uuidv7();
  const now = new Date();
  const action = {
    toolName: "write_file",
    canonicalArgs: { path: canaryPath, append: marker },
    target: canaryPath,
    workingDirectory: dataDir,
  };
  const pending = createApprovalRequest({
    id: approvalId,
    actionProposalId: uuidv7(),
    requesterId: ownerId,
    action,
    purpose: "Append the non-secret US1 marker exactly once after explicit approval",
    impact: `Append to ${canaryPath}`,
    risk: "high",
    displayArgs: { path: canaryPath, append: marker },
    secretRefs: [],
    policyRevision: 1,
    now,
    requiredApproverPolicy: { approverIds: [ownerId], allowRequesterSelfApproval: true },
    runId: run.runId,
    attemptId,
    toolCallId,
  });
  await database.execute(
    "INSERT INTO tool_call_record (id, run_attempt_id, tool_call_id, tool_name, original_args_digest, effective_args_digest, state, preflight_at) VALUES (?, ?, ?, 'write_file', ?, ?, 'waiting_approval', ?)",
    [
      toolCallId,
      attemptId,
      toolCallId,
      pending.proposal.actionDigest,
      pending.proposal.actionDigest,
      now.toISOString(),
    ],
  );
  await store.save(pending);
  await database.execute(
    "UPDATE run SET state = 'waiting_approval' WHERE id = ? AND state IN ('running', 'waiting_approval')",
    [run.runId],
  );
  await appendEvent({
    workspaceId: run.workspaceId,
    runId: run.runId,
    actorId: ownerId,
    type: "tool.preflight",
    payload: {
      toolCallId,
      toolName: "write_file",
      state: "waiting_approval",
      approvalRequired: true,
      displayArgs: pending.proposal.displayArgs,
    },
  });
  await appendEvent({
    workspaceId: run.workspaceId,
    runId: run.runId,
    actorId: ownerId,
    type: "approval.requested",
    payload: {
      approvalId,
      toolCallId,
      toolName: "write_file",
      approvalRequired: true,
      displayArgs: pending.proposal.displayArgs,
    },
  });
  return pending;
}
async function seedRun(run) {
  const attemptId = uuidv7();
  const now = new Date();
  await database.execute(
    "INSERT INTO run_attempt (id, run_id, worker_id, attempt_epoch, state, lease_expires_at, started_at) VALUES (?, ?, 'us1-validation-worker', 1, 'running', ?, ?)",
    [attemptId, run.runId, new Date(now.getTime() + 3_600_000).toISOString(), now.toISOString()],
  );
  const brief = await readFile(resolve(dataDir, "brief.md"), "utf8");
  const readCallId = uuidv7();
  await database.execute(
    "INSERT INTO tool_call_record (id, run_attempt_id, tool_call_id, tool_name, original_args_digest, effective_args_digest, state, preflight_at, execution_entered_at, finalized_at) VALUES (?, ?, ?, 'read_file', ?, ?, 'succeeded', ?, ?, ?)",
    [
      readCallId,
      attemptId,
      readCallId,
      digest({ path: "brief.md" }),
      digest({ path: "brief.md" }),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    ],
  );
  await appendEvent({
    workspaceId: run.workspaceId,
    runId: run.runId,
    actorId: run.owner_id,
    type: "tool.finalized",
    payload: {
      toolCallId: readCallId,
      toolName: "read_file",
      state: "succeeded",
      result: "succeeded",
      output: brief,
    },
  });
  const markdown = `# US1 validation report\n\nThe read-only fixture returned ${brief.trim()}.\n`;
  await artifacts.upload(
    run.owner_id,
    run.workspaceId,
    {
      name: artifactName,
      mediaType: "text/markdown",
      size: Buffer.byteLength(markdown),
      sha256: `sha256:${createHash("sha256").update(markdown).digest("hex")}`,
      kind: "reference",
      sourceSummary: "Faux read-only fixture result",
      runId: run.runId,
    },
    new TextEncoder().encode(markdown),
    uuidv7(),
  );
  await proposeWrite(run, attemptId);
}

const server = await buildServer({
  dataDir,
  ownerToken,
  logger: false,
  onApproved: async (record) => {
    if (record.decision === undefined || record.proposal.toolName !== "write_file") return;
    const runId = record.proposal.runId;
    const workspaceRows = await database.query(
      "SELECT id AS workspaceId, owner_id AS ownerId FROM workspace WHERE id = (SELECT workspace_id FROM run WHERE id = ?)",
      [runId],
    );
    const workspace = workspaceRows[0];
    if (workspace === undefined) throw new Error("Approved US1 workspace is missing");
    const now = new Date();
    const issued = issueExecutionPermit({
      id: uuidv7(),
      request: record.request,
      proposal: record.proposal,
      decision: record.decision,
      runAttemptId: record.proposal.attemptId,
      policyRevision: record.request.policyRevision,
      now,
    });
    if (issued.permit === undefined)
      throw new Error(issued.error?.message ?? "Permit issuance failed");
    await database.execute(
      "INSERT INTO execution_permit (id, approval_decision_id, action_digest, run_attempt_id, policy_revision, expires_at, consumed_at, consumption_result) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
      [
        issued.permit.id,
        issued.permit.approvalDecisionId,
        issued.permit.actionDigest,
        issued.permit.runAttemptId,
        issued.permit.policyRevision,
        issued.permit.expiresAt,
      ],
    );
    const gate = createSqliteApprovalGate(database);
    const result = await executeGuardedTool({
      gate,
      approvalId: record.request.id,
      action: {
        toolName: "write_file",
        canonicalArgs: { path: canaryPath, append: marker },
        target: canaryPath,
        workingDirectory: dataDir,
      },
      actionDigest: record.proposal.actionDigest,
      runAttemptId: record.proposal.attemptId,
      policyRevision: record.request.policyRevision,
      toolCallId: record.proposal.toolCallId,
      invoke: async () => {
        await appendFile(canaryPath, marker, "utf8");
        return "appended";
      },
    });
    const state =
      result.status === "succeeded"
        ? "succeeded"
        : result.status === "outcome_unknown"
          ? "outcome_unknown"
          : "blocked";
    const finalizedAt = new Date().toISOString();
    await database.execute(
      "UPDATE tool_call_record SET state = ?, execution_entered_at = COALESCE(execution_entered_at, ?), finalized_at = CASE WHEN ? = 'outcome_unknown' THEN NULL ELSE ? END WHERE tool_call_id = ?",
      [state, finalizedAt, state, finalizedAt, record.proposal.toolCallId],
    );
    await database.execute(
      "UPDATE run SET state = 'running' WHERE id = ? AND state = 'waiting_approval'",
      [runId],
    );
    if (result.status !== "blocked") {
      await appendEvent({
        workspaceId: workspace.workspaceId,
        runId,
        actorId: workspace.ownerId,
        type: "approval.permit_consumed",
        payload: {
          approvalId: record.request.id,
          permitId: issued.permit.id,
          toolCallId: record.proposal.toolCallId,
          toolName: "write_file",
        },
      });
      await appendEvent({
        workspaceId: workspace.workspaceId,
        runId,
        actorId: workspace.ownerId,
        type: "tool.execution_entered",
        payload: {
          toolCallId: record.proposal.toolCallId,
          toolName: "write_file",
          state: "running",
        },
      });
      await appendEvent({
        workspaceId: workspace.workspaceId,
        runId,
        actorId: workspace.ownerId,
        type: "tool.finalized",
        payload: {
          toolCallId: record.proposal.toolCallId,
          toolName: "write_file",
          state,
          result: state,
        },
      });
    }
  },
});
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const fresh = await database.query(
      `SELECT r.id AS runId, r.workspace_id AS workspaceId, w.owner_id FROM run r JOIN workspace w ON w.id = r.workspace_id WHERE w.kind = 'personal' AND w.goal LIKE ? AND NOT EXISTS (SELECT 1 FROM run_attempt ra WHERE ra.run_id = r.id)`,
      [`%${artifactName}%`],
    );
    for (const run of fresh) await seedRun(run);
    const rejected = await database.query(
      `SELECT ap.run_id AS runId, w.id AS workspaceId, w.owner_id, ap.attempt_id AS attemptId
      FROM action_proposal ap JOIN run r ON r.id = ap.run_id JOIN workspace w ON w.id = r.workspace_id
      WHERE w.kind = 'personal' AND w.goal LIKE ?
      GROUP BY ap.run_id HAVING COUNT(DISTINCT ap.id) = 1`,
      [`%${artifactName}%`],
    );
    // Use an explicit decision join without assuming that a second proposal exists.
    for (const run of rejected) {
      const counts = await database.query(
        `SELECT COUNT(DISTINCT ap.id) AS proposals, COUNT(DISTINCT ad.id) AS rejectedDecisions FROM action_proposal ap JOIN approval_request ar ON ar.action_proposal_id = ap.id JOIN approval_decision ad ON ad.approval_request_id = ar.id AND ad.decision = 'rejected' WHERE ap.run_id = ?`,
        [run.runId],
      );
      if (Number(counts[0]?.proposals) === 1 && Number(counts[0]?.rejectedDecisions) === 1)
        await proposeWrite(run, run.attemptId);
    }
  } finally {
    polling = false;
  }
}

await server.listen({ host: "127.0.0.1", port });
if (process.env.UNSPOOL_E2E_US1_RUNNER_PID_FILE)
  await writeFile(process.env.UNSPOOL_E2E_US1_RUNNER_PID_FILE, String(process.pid));
console.log(`US1 validation Runner listening at http://127.0.0.1:${port}/v1 pid=${process.pid}`);
const interval = setInterval(() => {
  void poll().catch((error) => console.error(error));
}, 30);
const shutdown = async () => {
  clearInterval(interval);
  await server.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
