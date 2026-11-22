import { randomUUID } from "node:crypto";
import {
  type ActionEnvelope,
  type ActionProposal,
  createActionProposal,
  type JsonObject,
} from "../../../../packages/domain/src/action-proposal.js";
import {
  type ApprovalAudit,
  type ApprovalDecision,
  type ApprovalPolicyError,
  decideApproval as decideDomainApproval,
  type HumanApprovalDecision,
} from "../../../../packages/domain/src/approval-decision.js";
import {
  type ApprovalRequest,
  createApprovalRequest as createDomainApprovalRequest,
  type RequiredApproverPolicy,
} from "../../../../packages/domain/src/approval-request.js";
import {
  type ConsumeExecutionPermitInput,
  type ConsumeExecutionPermitResult,
  consumeExecutionPermit as consumeDomainExecutionPermit,
  type IssueExecutionPermitInput,
  type IssueExecutionPermitResult,
  issueExecutionPermit as issueDomainExecutionPermit,
} from "../../../../packages/domain/src/execution-permit.js";

export { computeActionDigest } from "../../../../packages/domain/src/action-proposal.js";
export {
  DEFAULT_APPROVAL_TTL_MS,
  invalidateApprovalForChangedAction,
  isApprovalExpired,
} from "../../../../packages/domain/src/approval-request.js";

const DEFAULT_APPROVER_POLICY: RequiredApproverPolicy = Object.freeze({
  approverIds: Object.freeze([]),
  allowRequesterSelfApproval: false,
});

export interface CreateApprovalServiceInput {
  readonly id: string;
  readonly actionProposalId: string;
  readonly requesterId: string;
  readonly action: ActionEnvelope;
  readonly purpose: string;
  readonly impact: string;
  readonly risk: string;
  readonly displayArgs: JsonObject;
  readonly secretRefs: readonly string[];
  readonly policyRevision: number;
  readonly now: Date;
  readonly requiredApproverPolicy?: RequiredApproverPolicy;
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly expiresAt?: string;
  readonly ttlMs?: number;
}

export interface CreateApprovalServiceResult {
  readonly request: ApprovalRequest;
  readonly proposal: ActionProposal;
}

export interface ApprovalServiceError {
  readonly code: string;
  readonly message: string;
}

export interface ApprovalServiceAudit extends ApprovalAudit {
  readonly singleUserException: boolean;
  readonly approverId: string;
}

export interface DecideApprovalServiceInput {
  readonly id?: string;
  readonly request: ApprovalRequest;
  readonly proposal: ActionProposal;
  readonly actorId: string;
  readonly decision: HumanApprovalDecision;
  readonly actionDigest: string;
  readonly now: Date;
  readonly approverPolicy?: RequiredApproverPolicy;
  readonly reason?: string;
}

export interface DecideApprovalServiceResult {
  readonly request: ApprovalRequest;
  readonly proposal: ActionProposal;
  readonly decision?: ApprovalDecision;
  readonly error?: ApprovalServiceError;
  readonly audit?: ApprovalServiceAudit;
}

export type ConsumeApprovalPermitInput = Omit<ConsumeExecutionPermitInput, "now"> & {
  readonly now?: Date;
};

/**
 * Builds the real action proposal and its pending request. `displayArgs` and
 * `secretRefs` are provided separately from `canonicalArgs`; the digest binds
 * the real payload, while approver-visible fields never receive it.
 */
export function createApprovalRequest(
  input: CreateApprovalServiceInput,
): CreateApprovalServiceResult {
  const proposal = createActionProposal({
    id: input.actionProposalId,
    runId: input.runId ?? `run:${input.actionProposalId}`,
    attemptId: input.attemptId ?? `attempt:${input.actionProposalId}`,
    toolCallId: input.toolCallId ?? `tool-call:${input.actionProposalId}`,
    action: input.action,
    displayArgs: input.displayArgs,
    secretRefs: input.secretRefs,
    purpose: input.purpose,
    impact: input.impact,
    risk: input.risk,
    createdAt: input.now.toISOString(),
  });

  const request = createDomainApprovalRequest({
    id: input.id,
    actionProposalId: proposal.id,
    requesterId: input.requesterId,
    requiredApproverPolicy: input.requiredApproverPolicy ?? DEFAULT_APPROVER_POLICY,
    policyRevision: input.policyRevision,
    now: input.now,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
  });

  return { request, proposal };
}

/**
 * Applies the independent-approver policy. Rejections are recorded decisions,
 * but they still make the request unusable as an execution approval and are
 * reported with the boundary-level `approval_invalid` code.
 */
export function decideApproval(input: DecideApprovalServiceInput): DecideApprovalServiceResult {
  const outcome = decideDomainApproval({
    id: input.id ?? randomUUID(),
    request: input.request,
    proposal: input.proposal,
    actorId: input.actorId,
    decision: input.decision,
    actionDigest: input.actionDigest,
    now: input.now,
    ...(input.approverPolicy === undefined ? {} : { approverPolicy: input.approverPolicy }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });

  if (outcome.error !== undefined) {
    return {
      request: outcome.request,
      proposal: outcome.proposal,
      error: mapPolicyError(outcome.error),
    };
  }

  if (outcome.decision === undefined || outcome.audit === undefined) {
    return {
      request: outcome.request,
      proposal: outcome.proposal,
      error: {
        code: "approval_invalid",
        message: "Approval decision could not be bound to the current action",
      },
    };
  }

  const audit: ApprovalServiceAudit = {
    ...outcome.audit,
    singleUserException: outcome.audit.selfApprovalExceptionUsed,
    approverId: outcome.audit.actorId,
  };

  if (outcome.decision.decision === "rejected") {
    return {
      request: outcome.request,
      proposal: outcome.proposal,
      decision: outcome.decision,
      audit,
      error: {
        code: "approval_invalid",
        message: "Approval request was rejected; the action must not execute",
      },
    };
  }

  return {
    request: outcome.request,
    proposal: outcome.proposal,
    decision: outcome.decision,
    audit,
  };
}

export function issueExecutionPermit(input: IssueExecutionPermitInput): IssueExecutionPermitResult {
  return issueDomainExecutionPermit(input);
}

/**
 * Consumes the in-memory permit representation exactly once. Persistence must
 * perform the equivalent conditional update atomically; after this function
 * returns `consumed`, a replay sees the consumed permit and is rejected.
 */
export function consumeExecutionPermit(
  input: ConsumeApprovalPermitInput,
): ConsumeExecutionPermitResult {
  const outcome = consumeDomainExecutionPermit({
    ...input,
    now: input.now ?? new Date(),
  });

  if (outcome.status === "consumed") {
    Object.assign(input.permit, outcome.permit);
  }

  return outcome;
}

function mapPolicyError(error: ApprovalPolicyError): ApprovalServiceError {
  if (error.code === "self_approval_forbidden") {
    return {
      code: "self_approval_not_allowed",
      message: "The requester cannot approve their own high-risk action",
    };
  }

  return { code: error.code, message: error.message };
}
