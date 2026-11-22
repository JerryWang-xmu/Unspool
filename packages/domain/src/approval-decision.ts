import type { ActionProposal } from "./action-proposal.js";
import {
  type ApprovalRequest,
  isApprovalExpired,
  type RequiredApproverPolicy,
} from "./approval-request.js";

export type ApprovalDecisionKind = "approved" | "rejected" | "expired" | "invalidated";
export type HumanApprovalDecision = "approved" | "rejected";

export interface ApprovalDecision {
  id: string;
  approvalRequestId: string;
  decision: ApprovalDecisionKind;
  decidedBy: string;
  reason?: string | undefined;
  decidedAt: string;
  actionDigest: string;
}

export type ApprovalPolicyErrorCode =
  | "already_terminal"
  | "approval_expired"
  | "approval_invalid"
  | "invalid_decision"
  | "not_approver"
  | "self_approval_forbidden";

export interface ApprovalPolicyError {
  code: ApprovalPolicyErrorCode;
  message: string;
}

export interface ApprovalAudit {
  approvalRequestId: string;
  actorId: string;
  decision: HumanApprovalDecision;
  actionDigest: string;
  policyRevision: number;
  selfApprovalExceptionUsed: boolean;
  exceptionApprovedBy?: string | undefined;
  note: string;
}

export interface CreateApprovalDecisionInput {
  id: string;
  approvalRequestId: string;
  decision: ApprovalDecisionKind;
  decidedBy: string;
  reason?: string | undefined;
  decidedAt: Date | string;
  actionDigest: string;
}

export interface DecideApprovalInput {
  id: string;
  request: ApprovalRequest;
  proposal: ActionProposal;
  actorId: string;
  decision: HumanApprovalDecision;
  actionDigest: string;
  now: Date;
  approverPolicy?: RequiredApproverPolicy | undefined;
  reason?: string | undefined;
}

export interface DecideApprovalResult {
  request: ApprovalRequest;
  proposal: ActionProposal;
  decision?: ApprovalDecision | undefined;
  error?: ApprovalPolicyError | undefined;
  audit?: ApprovalAudit | undefined;
}

export function createApprovalDecision(input: CreateApprovalDecisionInput): ApprovalDecision {
  const reason = input.reason?.trim();

  return {
    id: input.id,
    approvalRequestId: input.approvalRequestId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    ...(reason ? { reason } : {}),
    decidedAt: input.decidedAt instanceof Date ? input.decidedAt.toISOString() : input.decidedAt,
    actionDigest: input.actionDigest,
  };
}

/**
 * Applies the approval policy and produces the terminal decision. The caller
 * must persist the returned request, decision, audit record, and domain event
 * in one transaction.
 */
export function decideApproval(input: DecideApprovalInput): DecideApprovalResult {
  const { request, proposal, now } = input;

  if (request.state !== "pending") {
    return failure(request, proposal, "already_terminal", "Approval request is already terminal");
  }

  if (isApprovalExpired(request, now)) {
    return {
      request: { ...request, state: "expired" },
      proposal,
      error: {
        code: "approval_expired",
        message: "Approval request expired before a decision was recorded",
      },
    };
  }

  if (request.actionProposalId !== proposal.id || input.actionDigest !== proposal.actionDigest) {
    return failure(
      request,
      proposal,
      "approval_invalid",
      "Decision does not bind the current action proposal digest",
    );
  }

  const policy = input.approverPolicy ?? request.requiredApproverPolicy;
  const approverIds = policy.approverIds ?? [];
  const isRequester = input.actorId === request.requesterId;
  const isListedApprover = approverIds.includes(input.actorId);
  const exception = policy.singleUserException;
  let selfApprovalExceptionUsed = false;
  let exceptionApprovedBy: string | undefined;

  if (input.decision === "approved" && isRequester) {
    if (policy.allowRequesterSelfApproval === true) {
      selfApprovalExceptionUsed = true;
    } else if (exception?.enabled === true) {
      if (!exception.approvedBy.trim() || !exception.reason.trim()) {
        return failure(
          request,
          proposal,
          "self_approval_forbidden",
          "Single-user exception requires an administrator and a reason",
        );
      }

      selfApprovalExceptionUsed = true;
      exceptionApprovedBy = exception.approvedBy;
    } else {
      return failure(
        request,
        proposal,
        "self_approval_forbidden",
        "The requester cannot approve their own high-risk action",
      );
    }
  } else if (!isRequester && !isListedApprover) {
    return failure(
      request,
      proposal,
      "not_approver",
      "Actor is not an eligible independent approver",
    );
  }

  const decision = createApprovalDecision({
    id: input.id,
    approvalRequestId: request.id,
    decision: input.decision,
    decidedBy: input.actorId,
    ...(input.reason ? { reason: input.reason } : {}),
    decidedAt: now,
    actionDigest: proposal.actionDigest,
  });

  const note = selfApprovalExceptionUsed
    ? exceptionApprovedBy
      ? `Single-user exception approved by ${exceptionApprovedBy}`
      : "Single-user exception explicitly allowed by policy"
    : input.decision === "approved"
      ? "Independent approval"
      : "Approval rejected";

  return {
    request: { ...request, state: input.decision },
    proposal,
    decision,
    audit: {
      approvalRequestId: request.id,
      actorId: input.actorId,
      decision: input.decision,
      actionDigest: proposal.actionDigest,
      policyRevision: request.policyRevision,
      selfApprovalExceptionUsed,
      ...(exceptionApprovedBy ? { exceptionApprovedBy } : {}),
      note,
    },
  };
}

function failure(
  request: ApprovalRequest,
  proposal: ActionProposal,
  code: ApprovalPolicyErrorCode,
  message: string,
): DecideApprovalResult {
  return { request, proposal, error: { code, message } };
}
