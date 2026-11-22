import type { ActionProposal } from "./action-proposal.js";
import type { ApprovalDecision } from "./approval-decision.js";
import { type ApprovalRequest, isApprovalExpired } from "./approval-request.js";

export type PermitConsumptionOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "outcome_unknown";

export interface ExecutionPermit {
  id: string;
  approvalDecisionId: string;
  actionDigest: string;
  runAttemptId: string;
  policyRevision: number;
  expiresAt: string;
  consumedAt?: string | undefined;
  consumptionResult?: PermitConsumptionOutcome | undefined;
}

export type PermitErrorCode =
  | "already_consumed"
  | "approval_expired"
  | "approval_invalid"
  | "attempt_mismatch"
  | "digest_mismatch"
  | "outcome_unknown"
  | "permit_expired"
  | "policy_mismatch";

export interface PermitError {
  code: PermitErrorCode;
  message: string;
}

export interface IssueExecutionPermitInput {
  id: string;
  request: ApprovalRequest;
  proposal: ActionProposal;
  decision: ApprovalDecision | undefined;
  runAttemptId: string;
  policyRevision: number;
  now: Date;
  expiresAt?: string | undefined;
}

export interface IssueExecutionPermitResult {
  permit?: ExecutionPermit | undefined;
  error?: PermitError | undefined;
}

export interface ConsumeExecutionPermitInput {
  permit: ExecutionPermit;
  actionDigest: string;
  runAttemptId: string;
  policyRevision: number;
  now: Date;
  executionResult?: PermitConsumptionOutcome | undefined;
  consumptionResult?: PermitConsumptionOutcome | undefined;
}

export interface ConsumeExecutionPermitResult {
  status: "consumed" | "rejected";
  permit: ExecutionPermit;
  error?: PermitError | undefined;
}

export function issueExecutionPermit(input: IssueExecutionPermitInput): IssueExecutionPermitResult {
  const { request, proposal, decision, now } = input;

  if (request.actionProposalId !== proposal.id) {
    return invalidPermit("Approval request does not reference the supplied proposal");
  }

  if (request.state === "expired" || isApprovalExpired(request, now)) {
    return {
      error: {
        code: "approval_expired",
        message: "Approval request is expired",
      },
    };
  }

  if (!decision) {
    return invalidPermit("An approved decision is required");
  }

  if (
    decision.approvalRequestId !== request.id ||
    decision.actionDigest !== proposal.actionDigest
  ) {
    return invalidPermit("Decision does not bind the current approval request and action");
  }

  if (request.state !== "approved" || decision.decision !== "approved") {
    return invalidPermit("Approval request has no effective approval");
  }

  if (input.policyRevision !== request.policyRevision) {
    return {
      error: {
        code: "policy_mismatch",
        message: "Execution permit policy revision does not match the approval",
      },
    };
  }

  const expiresAt = input.expiresAt ?? request.expiresAt;
  const expiresAtMs = Date.parse(expiresAt);
  const requestExpiresAtMs = Date.parse(request.expiresAt);

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return {
      error: {
        code: "approval_expired",
        message: "Cannot issue an already expired execution permit",
      },
    };
  }

  if (!Number.isFinite(requestExpiresAtMs) || expiresAtMs > requestExpiresAtMs) {
    return invalidPermit("Execution permit cannot outlive its approval request");
  }

  return {
    permit: {
      id: input.id,
      approvalDecisionId: decision.id,
      actionDigest: proposal.actionDigest,
      runAttemptId: input.runAttemptId,
      policyRevision: input.policyRevision,
      expiresAt,
    },
  };
}

/**
 * Applies the single-use policy. Persistence must perform the equivalent
 * `UPDATE ... WHERE consumed_at IS NULL` atomically; this function is the
 * decision step and never mutates the supplied permit.
 */
export function consumeExecutionPermit(
  input: ConsumeExecutionPermitInput,
): ConsumeExecutionPermitResult {
  const { permit } = input;

  if (permit.consumedAt !== undefined) {
    const unknown = permit.consumptionResult === "outcome_unknown";
    return {
      status: "rejected",
      permit,
      error: {
        code: unknown ? "outcome_unknown" : "already_consumed",
        message: unknown
          ? "Permit was consumed and the execution outcome is unknown"
          : "Execution permit has already been consumed",
      },
    };
  }

  if (input.actionDigest !== permit.actionDigest) {
    return consumeFailure(permit, "digest_mismatch", "Action digest does not match the permit");
  }

  if (input.runAttemptId !== permit.runAttemptId) {
    return consumeFailure(permit, "attempt_mismatch", "Run attempt does not match the permit");
  }

  if (input.policyRevision !== permit.policyRevision) {
    return consumeFailure(permit, "policy_mismatch", "Policy revision does not match the permit");
  }

  const expiresAtMs = Date.parse(permit.expiresAt);
  if (!Number.isFinite(expiresAtMs) || input.now.getTime() >= expiresAtMs) {
    return consumeFailure(permit, "permit_expired", "Execution permit is expired");
  }

  const consumptionResult = input.executionResult ?? input.consumptionResult ?? "succeeded";

  return {
    status: "consumed",
    permit: {
      ...permit,
      consumedAt: input.now.toISOString(),
      consumptionResult,
    },
  };
}

function invalidPermit(message: string): IssueExecutionPermitResult {
  return { error: { code: "approval_invalid", message } };
}

function consumeFailure(
  permit: ExecutionPermit,
  code: PermitErrorCode,
  message: string,
): ConsumeExecutionPermitResult {
  return { status: "rejected", permit, error: { code, message } };
}
