import {
  createHandoffSummary,
  type HandoffSummary,
} from "../../../../packages/domain/src/handoff-summary.js";
import type { SqliteTransaction } from "../../../../packages/persistence/src/database.js";
import { ProblemError } from "../errors/problem.js";

async function ids(
  transaction: SqliteTransaction,
  sql: string,
  params: readonly unknown[],
): Promise<string[]> {
  const rows = await transaction.query<{ id: string }>(sql, params);
  return rows.map((row) => row.id);
}

export async function buildHandoffSummary(
  transaction: SqliteTransaction,
  workspaceId: string,
  newId: () => string,
): Promise<HandoffSummary> {
  const workspaces = await transaction.query<{
    goal: string;
    criteria: string;
    revision: number;
    runnerId: string;
  }>(
    "SELECT goal, completion_criteria AS criteria, revision, runner_id AS runnerId FROM workspace WHERE id = ?",
    [workspaceId],
  );
  const workspace = workspaces[0];
  if (workspace === undefined) throw new ProblemError("not_found");
  const runs = await transaction.query<{ id: string; state: string }>(
    "SELECT id, state FROM run WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1",
    [workspaceId],
  );
  const summary = createHandoffSummary({
    id: newId(),
    workspaceId,
    revision: workspace.revision,
    goal: workspace.goal,
    criteria: workspace.criteria,
    runState: (runs[0]?.state ?? "created") as Parameters<
      typeof createHandoffSummary
    >[0]["runState"],
    decisions: await ids(
      transaction,
      "SELECT current_version_id AS id FROM context_item WHERE workspace_id = ? AND kind = 'decision' AND removed_at IS NULL",
      [workspaceId],
    ),
    completedWork: await ids(
      transaction,
      "SELECT id FROM run WHERE workspace_id = ? AND state = 'technical_complete'",
      [workspaceId],
    ),
    pendingApprovalIds: await ids(
      transaction,
      "SELECT ar.id FROM approval_request ar JOIN action_proposal ap ON ap.id = ar.action_proposal_id JOIN run r ON r.id = ap.run_id WHERE r.workspace_id = ? AND ar.state = 'pending'",
      [workspaceId],
    ),
    queueIds: await ids(
      transaction,
      "SELECT qi.id FROM queued_instruction qi JOIN run r ON r.id = qi.run_id WHERE r.workspace_id = ? AND qi.state IN ('queued', 'modified')",
      [workspaceId],
    ),
    todoIds: await ids(
      transaction,
      "SELECT current_version_id AS id FROM context_item WHERE workspace_id = ? AND kind = 'todo' AND removed_at IS NULL",
      [workspaceId],
    ),
    artifactIds: await ids(
      transaction,
      "SELECT av.id FROM artifact_version av LEFT JOIN run r ON r.id = av.run_id WHERE av.origin_id = ? OR r.workspace_id = ?",
      [workspaceId, workspaceId],
    ),
    blockers: await ids(
      transaction,
      "SELECT current_version_id AS id FROM context_item WHERE workspace_id = ? AND kind = 'blocker' AND removed_at IS NULL",
      [workspaceId],
    ),
    grantIds: (
      await transaction.query<{ id: string }>(
        "SELECT runner_id || ':' || subject_type || ':' || subject_id AS id FROM runner_grant WHERE runner_id = ?",
        [workspace.runnerId],
      )
    ).map((row) => row.id),
  });
  await transaction.execute(
    `INSERT INTO handoff_summary (id, workspace_id, revision, goal, criteria, run_state, decisions, completed_work, pending_approval_ids, queue_ids, todo_ids, artifact_ids, blockers, grant_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      summary.id,
      workspaceId,
      summary.revision,
      summary.goal,
      summary.criteria,
      summary.runState,
      JSON.stringify(summary.decisions),
      JSON.stringify(summary.completedWork),
      JSON.stringify(summary.pendingApprovalIds),
      JSON.stringify(summary.queueIds),
      JSON.stringify(summary.todoIds),
      JSON.stringify(summary.artifactIds),
      JSON.stringify(summary.blockers),
      JSON.stringify(summary.grantIds),
    ],
  );
  return summary;
}

export async function readHandoffSummary(
  transaction: SqliteTransaction,
  summaryId: string,
): Promise<HandoffSummary> {
  const rows = await transaction.query<Record<string, unknown>>(
    "SELECT * FROM handoff_summary WHERE id = ?",
    [summaryId],
  );
  const row = rows[0];
  if (row === undefined) throw new ProblemError("not_found");
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    revision: Number(row.revision),
    goal: String(row.goal),
    criteria: String(row.criteria),
    runState: row.run_state as HandoffSummary["runState"],
    decisions: JSON.parse(String(row.decisions)),
    completedWork: JSON.parse(String(row.completed_work)),
    pendingApprovalIds: JSON.parse(String(row.pending_approval_ids)),
    queueIds: JSON.parse(String(row.queue_ids)),
    todoIds: JSON.parse(String(row.todo_ids)),
    artifactIds: JSON.parse(String(row.artifact_ids)),
    blockers: JSON.parse(String(row.blockers)),
    grantIds: JSON.parse(String(row.grant_ids)),
  };
}
