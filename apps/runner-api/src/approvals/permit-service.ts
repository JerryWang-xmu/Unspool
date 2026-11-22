import {
  type ConsumeExecutionPermitInput,
  type ConsumeExecutionPermitResult,
  consumeExecutionPermit as decidePermitConsumption,
  type ExecutionPermit,
  type PermitConsumptionOutcome,
} from "../../../../packages/domain/src/execution-permit.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";

export type {
  ConsumeExecutionPermitInput,
  ConsumeExecutionPermitResult,
  ExecutionPermit,
  IssueExecutionPermitInput,
  IssueExecutionPermitResult,
} from "../../../../packages/domain/src/execution-permit.js";
export {
  consumeExecutionPermit,
  issueExecutionPermit,
} from "../../../../packages/domain/src/execution-permit.js";

interface PermitRow {
  readonly id: string;
  readonly approval_decision_id: string;
  readonly action_digest: string;
  readonly run_attempt_id: string;
  readonly policy_revision: number;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly consumption_result: PermitConsumptionOutcome | null;
}

const FINAL_CONSUMPTION_OUTCOMES: ReadonlySet<PermitConsumptionOutcome> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function view(row: PermitRow): ExecutionPermit {
  return {
    id: row.id,
    approvalDecisionId: row.approval_decision_id,
    actionDigest: row.action_digest,
    runAttemptId: row.run_attempt_id,
    policyRevision: row.policy_revision,
    expiresAt: row.expires_at,
    ...(row.consumed_at === null ? {} : { consumedAt: row.consumed_at }),
    ...(row.consumption_result === null ? {} : { consumptionResult: row.consumption_result }),
  };
}

export async function loadExecutionPermitForDecision(
  database: SqliteDatabase,
  decisionId: string,
): Promise<ExecutionPermit | undefined> {
  const rows = await database.query<PermitRow>(
    "SELECT * FROM execution_permit WHERE approval_decision_id = ? ORDER BY rowid DESC LIMIT 1",
    [decisionId],
  );
  const row = rows[0];
  return row === undefined ? undefined : view(row);
}

/**
 * Re-reads and consumes a permit inside BEGIN IMMEDIATE. The conditional UPDATE
 * is the side-effect gate; a second consumer sees the committed consumption and
 * can never execute the tool again.
 */
export async function consumeExecutionPermitAtomic(
  database: SqliteDatabase,
  input: ConsumeExecutionPermitInput,
): Promise<ConsumeExecutionPermitResult> {
  return database.write(async (transaction) => {
    const rows = await transaction.query<PermitRow>("SELECT * FROM execution_permit WHERE id = ?", [
      input.permit.id,
    ]);
    const row = rows[0];
    if (row === undefined) {
      return {
        status: "rejected",
        permit: input.permit,
        error: { code: "approval_invalid", message: "Execution permit does not exist." },
      };
    }
    const persisted = view(row);
    const authorization = await transaction.query<{
      request_state: string;
      request_policy: number;
      proposal_digest: string;
      proposal_attempt: string;
      decision_state: string;
      decision_digest: string;
    }>(
      `SELECT ar.state AS request_state, ar.policy_revision AS request_policy,
              ap.action_digest AS proposal_digest, ap.attempt_id AS proposal_attempt,
              ad.decision AS decision_state, ad.action_digest AS decision_digest
         FROM execution_permit ep
         JOIN approval_decision ad ON ad.id = ep.approval_decision_id
         JOIN approval_request ar ON ar.id = ad.approval_request_id
         JOIN action_proposal ap ON ap.id = ar.action_proposal_id
        WHERE ep.id = ?`,
      [input.permit.id],
    );
    const current = authorization[0];
    if (
      current === undefined ||
      current.request_state !== "approved" ||
      current.decision_state !== "approved" ||
      current.request_policy !== input.policyRevision ||
      current.proposal_attempt !== input.runAttemptId ||
      current.proposal_digest !== input.actionDigest ||
      current.decision_digest !== input.actionDigest ||
      persisted.actionDigest !== input.actionDigest ||
      persisted.runAttemptId !== input.runAttemptId ||
      persisted.policyRevision !== input.policyRevision
    ) {
      return {
        status: "rejected",
        permit: persisted,
        error: {
          code: "approval_invalid",
          message: "Approval is no longer valid for this exact action and attempt.",
        },
      };
    }
    const decision = decidePermitConsumption({ ...input, permit: persisted });
    if (decision.status === "rejected") return decision;
    const consumedAt = decision.permit.consumedAt;
    const consumptionResult = decision.permit.consumptionResult;
    if (consumedAt === undefined || consumptionResult === undefined)
      throw new Error("Consumed permit is missing its audit fields");
    await transaction.execute(
      "UPDATE execution_permit SET consumed_at = ?, consumption_result = ? WHERE id = ? AND consumed_at IS NULL",
      [consumedAt, consumptionResult, persisted.id],
    );
    const committedRows = await transaction.query<PermitRow>(
      "SELECT * FROM execution_permit WHERE id = ?",
      [persisted.id],
    );
    const committed = committedRows[0];
    if (committed === undefined)
      throw new Error("Consumed permit disappeared inside its transaction");
    if (
      committed.consumed_at !== consumedAt ||
      committed.consumption_result !== consumptionResult
    ) {
      return decidePermitConsumption({ ...input, permit: view(committed) });
    }
    return { status: "consumed", permit: view(committed) };
  });
}

/**
 * Writes only the final tool outcome for an already-consumed permit. The
 * consumed timestamp is compared but never rewritten, and the conditional
 * update plus the migration-64 trigger allow exactly one transition from
 * `outcome_unknown` to a final outcome. Replays and cleared consumption are
 * rejected before any write.
 */
export async function finalizeExecutionPermitOutcome(
  database: SqliteDatabase,
  permit: ExecutionPermit,
): Promise<void> {
  await database.write(async (transaction) => {
    const rows = await transaction.query<PermitRow>("SELECT * FROM execution_permit WHERE id = ?", [
      permit.id,
    ]);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Execution permit does not exist.");
    }
    if (row.consumed_at === null) {
      throw new Error("Execution permit has not been consumed.");
    }
    if (permit.consumedAt === undefined || row.consumed_at !== permit.consumedAt) {
      throw new Error("Execution permit consumption does not match the persisted permit.");
    }
    const outcome = permit.consumptionResult;
    if (outcome === undefined) {
      throw new Error("Final execution permit outcome is missing.");
    }
    if (row.consumption_result !== "outcome_unknown") {
      throw new Error("Execution permit outcome is already final.");
    }
    if (!FINAL_CONSUMPTION_OUTCOMES.has(outcome)) {
      return;
    }
    await transaction.execute(
      "UPDATE execution_permit SET consumption_result = ? WHERE id = ? AND consumed_at = ? AND consumption_result = 'outcome_unknown'",
      [outcome, permit.id, permit.consumedAt],
    );
    const committed = (
      await transaction.query<PermitRow>("SELECT * FROM execution_permit WHERE id = ?", [permit.id])
    )[0];
    if (
      committed === undefined ||
      committed.consumed_at !== permit.consumedAt ||
      committed.consumption_result !== outcome
    ) {
      throw new Error("Execution permit outcome could not be finalized.");
    }
  });
}
