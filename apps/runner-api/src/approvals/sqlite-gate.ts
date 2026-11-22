import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import type {
  ApprovalGate,
  ApprovalRecord,
} from "../../../../packages/pi-adapter/src/approval-gate.js";
import {
  ApprovalGateError,
  createApprovalGate,
} from "../../../../packages/pi-adapter/src/approval-gate.js";
import {
  consumeExecutionPermitAtomic,
  finalizeExecutionPermitOutcome,
  loadExecutionPermitForDecision,
} from "./permit-service.js";
import { createSqliteApprovalStore } from "./store.js";

export interface SqliteApprovalGateOptions {
  readonly now?: () => Date;
  /** Deterministic persistence-interleaving probe used by integration tests. */
  readonly beforeConsume?: (() => void | Promise<void>) | undefined;
}

/**
 * SQLite-backed approval gate. Authorization and every policy decision stay in
 * `createApprovalGate`; this factory only supplies durable loading, the
 * conditional single-use consume, and outcome-only finalization.
 */
export function createSqliteApprovalGate(
  database: SqliteDatabase,
  options: SqliteApprovalGateOptions = {},
): ApprovalGate {
  const store = createSqliteApprovalStore(database);
  const now = options.now ?? (() => new Date());

  return createApprovalGate({
    now,

    async loadApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
      const record = await store.get(approvalId);
      if (record === undefined) return undefined;
      const permit =
        record.decision === undefined
          ? undefined
          : await loadExecutionPermitForDecision(database, record.decision.id);
      return {
        request: record.request,
        proposal: record.proposal,
        ...(record.decision === undefined ? {} : { decision: record.decision }),
        ...(permit === undefined ? {} : { permit }),
      };
    },

    async invalidateApproval(approvalId: string, _reason: string) {
      await database.write(async (transaction) => {
        await transaction.execute(
          "UPDATE approval_request SET state = 'invalidated' WHERE id = ? AND state IN ('pending', 'approved')",
          [approvalId],
        );
      });
    },

    async consumePermit(permit) {
      await options.beforeConsume?.();
      const result = await consumeExecutionPermitAtomic(database, {
        permit,
        actionDigest: permit.actionDigest,
        runAttemptId: permit.runAttemptId,
        policyRevision: permit.policyRevision,
        now: now(),
        consumptionResult: "outcome_unknown",
      });
      if (result.status === "rejected") {
        throw new ApprovalGateError(
          result.error?.code ?? "approval_invalid",
          result.error?.message ?? "Execution permit is no longer valid",
        );
      }
      return result.permit;
    },

    async savePermit(permit) {
      await finalizeExecutionPermitOutcome(database, permit);
    },
  });
}
