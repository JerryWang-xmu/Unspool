import type { ActionProposal } from "../../../../packages/domain/src/action-proposal.js";
import type { ApprovalDecision } from "../../../../packages/domain/src/approval-decision.js";
import type { ApprovalRequest } from "../../../../packages/domain/src/approval-request.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import { ProblemError } from "../errors/problem.js";
import type { ApprovalStore, StoredApproval } from "../routes/approvals.js";

function proposal(row: Record<string, unknown>): ActionProposal {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    attemptId: String(row.attempt_id),
    toolCallId: String(row.tool_call_id),
    toolName: String(row.tool_name),
    canonicalArgs: JSON.parse(String(row.canonical_args)),
    displayArgs: JSON.parse(String(row.display_args)),
    secretRefs: JSON.parse(String(row.secret_refs)),
    actionDigest: String(row.action_digest),
    purpose: String(row.purpose),
    impact: String(row.impact),
    risk: String(row.risk),
    baseResourceVersions: JSON.parse(String(row.base_resource_versions)),
    createdAt: String(row.created_at),
  };
}

function request(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(row.id),
    actionProposalId: String(row.action_proposal_id),
    requesterId: String(row.requester_id),
    requiredApproverPolicy: JSON.parse(String(row.required_approver_policy)),
    state: row.state as ApprovalRequest["state"],
    expiresAt: String(row.expires_at),
    policyRevision: Number(row.policy_revision),
    createdAt: String(row.created_at),
  };
}

function decision(row: Record<string, unknown>): ApprovalDecision {
  return {
    id: String(row.id),
    approvalRequestId: String(row.approval_request_id),
    decision: row.decision as ApprovalDecision["decision"],
    decidedBy: String(row.decided_by),
    ...(row.reason === null ? {} : { reason: String(row.reason) }),
    decidedAt: String(row.decided_at),
    actionDigest: String(row.action_digest),
  };
}

const SELECT = `SELECT ar.*, ap.run_id, ap.attempt_id, ap.tool_call_id, ap.tool_name, ap.canonical_args,
  ap.display_args, ap.secret_refs, ap.action_digest, ap.purpose, ap.impact, ap.risk,
  ap.base_resource_versions, ap.created_at AS proposal_created_at, r.workspace_id
  FROM approval_request ar
  JOIN action_proposal ap ON ap.id = ar.action_proposal_id
  JOIN run r ON r.id = ap.run_id`;

export function createSqliteApprovalStore(database: SqliteDatabase): ApprovalStore {
  async function load(id: string): Promise<StoredApproval | undefined> {
    const rows = await database.query<Record<string, unknown>>(`${SELECT} WHERE ar.id = ?`, [id]);
    const row = rows[0];
    if (row === undefined) return undefined;
    const decisions = await database.query<Record<string, unknown>>(
      "SELECT * FROM approval_decision WHERE approval_request_id = ? ORDER BY decided_at DESC LIMIT 1",
      [id],
    );
    return {
      request: request(row),
      proposal: proposal({
        ...row,
        id: row.action_proposal_id,
        created_at: row.proposal_created_at,
      }),
      ...(row.workspace_id === undefined || row.workspace_id === null
        ? {}
        : { workspaceId: String(row.workspace_id) }),
      ...(decisions[0] === undefined ? {} : { decision: decision(decisions[0]) }),
    };
  }

  return {
    get: load,
    async list() {
      const rows = await database.query<Record<string, unknown>>(
        `${SELECT} ORDER BY ar.created_at DESC`,
      );
      const records: StoredApproval[] = [];
      for (const row of rows) {
        const record = await load(String(row.id));
        if (record !== undefined) records.push(record);
      }
      return records;
    },
    async decidePending(record) {
      await database.write(async (transaction) => {
        const current = await transaction.query<{ state: string }>(
          "SELECT state FROM approval_request WHERE id = ?",
          [record.request.id],
        );
        if (current[0]?.state !== "pending") throw new ProblemError("approval_invalid");
        const p = record.proposal;
        const existingProposal = await transaction.query<{ action_digest: string }>(
          "SELECT action_digest FROM action_proposal WHERE id = ?",
          [p.id],
        );
        if (
          existingProposal[0] !== undefined &&
          existingProposal[0].action_digest !== p.actionDigest
        )
          throw new ProblemError("approval_invalid");
        if (existingProposal[0] === undefined) {
          await transaction.execute(
            `INSERT INTO action_proposal (id, run_id, attempt_id, tool_call_id, tool_name, canonical_args, display_args, secret_refs, action_digest, purpose, impact, risk, base_resource_versions, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              p.id,
              p.runId,
              p.attemptId,
              p.toolCallId,
              p.toolName,
              JSON.stringify(p.canonicalArgs),
              JSON.stringify(p.displayArgs),
              JSON.stringify(p.secretRefs),
              p.actionDigest,
              p.purpose,
              p.impact,
              p.risk,
              JSON.stringify(p.baseResourceVersions),
              p.createdAt,
            ],
          );
        }
        const r = record.request;
        const transition = await transaction.execute(
          "UPDATE approval_request SET state = ?, expires_at = ?, policy_revision = ? WHERE id = ? AND state = 'pending'",
          [r.state, r.expiresAt, r.policyRevision, r.id],
        );
        void transition;
        if (record.decision !== undefined) {
          const d = record.decision;
          await transaction.execute(
            "INSERT INTO approval_decision (id, approval_request_id, decision, decided_by, reason, decided_at, action_digest) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              d.id,
              d.approvalRequestId,
              d.decision,
              d.decidedBy,
              d.reason ?? null,
              d.decidedAt,
              d.actionDigest,
            ],
          );
        }
        if (record.audit !== undefined) {
          const audit = record.audit;
          await transaction.execute(
            "INSERT INTO approval_audit (approval_request_id, actor_id, decision, action_digest, policy_revision, self_approval_exception_used, exception_approved_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              r.id,
              audit.actorId,
              audit.decision,
              audit.actionDigest,
              audit.policyRevision,
              audit.selfApprovalExceptionUsed ? 1 : 0,
              audit.exceptionApprovedBy ?? null,
              audit.note,
              r.createdAt,
            ],
          );
        }
      });
    },
    async save(record) {
      await database.write(async (transaction) => {
        const p = record.proposal;
        await transaction.execute(
          `INSERT INTO action_proposal (id, run_id, attempt_id, tool_call_id, tool_name, canonical_args, display_args, secret_refs, action_digest, purpose, impact, risk, base_resource_versions, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.runId,
            p.attemptId,
            p.toolCallId,
            p.toolName,
            JSON.stringify(p.canonicalArgs),
            JSON.stringify(p.displayArgs),
            JSON.stringify(p.secretRefs),
            p.actionDigest,
            p.purpose,
            p.impact,
            p.risk,
            JSON.stringify(p.baseResourceVersions),
            p.createdAt,
          ],
        );
        const r = record.request;
        await transaction.execute(
          `INSERT INTO approval_request (id, action_proposal_id, requester_id, required_approver_policy, state, expires_at, policy_revision, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, expires_at = excluded.expires_at, policy_revision = excluded.policy_revision`,
          [
            r.id,
            r.actionProposalId,
            r.requesterId,
            JSON.stringify(r.requiredApproverPolicy),
            r.state,
            r.expiresAt,
            r.policyRevision,
            r.createdAt,
          ],
        );
        if (record.decision !== undefined) {
          const d = record.decision;
          await transaction.execute(
            "INSERT INTO approval_decision (id, approval_request_id, decision, decided_by, reason, decided_at, action_digest) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              d.id,
              d.approvalRequestId,
              d.decision,
              d.decidedBy,
              d.reason ?? null,
              d.decidedAt,
              d.actionDigest,
            ],
          );
        }
        if (record.audit !== undefined) {
          const audit = record.audit;
          await transaction.execute(
            "INSERT INTO approval_audit (approval_request_id, actor_id, decision, action_digest, policy_revision, self_approval_exception_used, exception_approved_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              r.id,
              audit.actorId,
              audit.decision,
              audit.actionDigest,
              audit.policyRevision,
              audit.selfApprovalExceptionUsed ? 1 : 0,
              audit.exceptionApprovedBy ?? null,
              audit.note,
              r.createdAt,
            ],
          );
        }
      });
    },
  };
}
