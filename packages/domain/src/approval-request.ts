import {
  type ActionEnvelope,
  type ActionProposal,
  computeActionDigest,
} from "./action-proposal.js";

export type ApprovalRequestState = "pending" | "approved" | "rejected" | "expired" | "invalidated";

export interface SingleUserApprovalException {
  readonly enabled: boolean;
  readonly approvedBy: string;
  readonly reason: string;
}

export interface RequiredApproverPolicy {
  readonly approverIds: readonly string[];
  readonly allowRequesterSelfApproval: boolean;
  readonly singleUserException?: SingleUserApprovalException;
}

export interface ApprovalRequest {
  id: string;
  actionProposalId: string;
  requesterId: string;
  requiredApproverPolicy: RequiredApproverPolicy;
  state: ApprovalRequestState;
  expiresAt: string;
  policyRevision: number;
  createdAt: string;
}

export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1_000;

export interface CreateApprovalRequestInput {
  id: string;
  actionProposalId: string;
  requesterId: string;
  requiredApproverPolicy: RequiredApproverPolicy;
  policyRevision: number;
  now: Date;
  expiresAt?: string | undefined;
  ttlMs?: number | undefined;
}

export interface InvalidateApprovalForChangedActionInput {
  request: ApprovalRequest;
  proposal: ActionProposal;
  nextAction: ActionEnvelope;
  now: Date;
  reason?: string | undefined;
}

export interface InvalidateApprovalForChangedActionResult {
  request: ApprovalRequest;
  invalidated: boolean;
  nextActionDigest: string;
  reason?: string | undefined;
}

const TERMINAL_APPROVAL_STATES: ReadonlySet<ApprovalRequestState> = new Set([
  "approved",
  "rejected",
  "expired",
  "invalidated",
]);

export function createApprovalRequest(input: CreateApprovalRequestInput): ApprovalRequest {
  const ttlMs = input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("Approval request TTL must be a finite positive duration");
  }

  const expiresAt = input.expiresAt ?? new Date(input.now.getTime() + ttlMs).toISOString();

  return {
    id: input.id,
    actionProposalId: input.actionProposalId,
    requesterId: input.requesterId,
    requiredApproverPolicy: input.requiredApproverPolicy,
    state: "pending",
    expiresAt,
    policyRevision: input.policyRevision,
    createdAt: input.now.toISOString(),
  };
}

export function isApprovalTerminal(state: ApprovalRequestState): boolean {
  return TERMINAL_APPROVAL_STATES.has(state);
}

export function isApprovalExpired(request: Pick<ApprovalRequest, "expiresAt">, now: Date): boolean {
  const nowMs = now.getTime();
  const expiresAtMs = Date.parse(request.expiresAt);

  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) {
    return true;
  }

  return nowMs >= expiresAtMs;
}

/**
 * A pending request becomes expired at the exact deadline. Terminal states are
 * never reopened.
 */
export function expireApprovalRequest(request: ApprovalRequest, now: Date): ApprovalRequest {
  if (request.state !== "pending" || !isApprovalExpired(request, now)) {
    return request;
  }

  return { ...request, state: "expired" };
}

/**
 * Content or scope changes generate a new proposal and invalidate the old
 * request. Rejected, expired, and already-invalidated requests stay unchanged.
 */
export function invalidateApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  if (request.state !== "pending" && request.state !== "approved") {
    return request;
  }

  return { ...request, state: "invalidated" };
}

/**
 * Compares the real canonical action, not display arguments. An unchanged
 * action keeps the current approval; a changed action invalidates it unless it
 * already reached another terminal state.
 */
export function invalidateApprovalForChangedAction(
  input: InvalidateApprovalForChangedActionInput,
): InvalidateApprovalForChangedActionResult {
  if (input.request.actionProposalId !== input.proposal.id) {
    throw new Error("Approval request does not reference the supplied action proposal");
  }

  const nextActionDigest = computeActionDigest(input.nextAction);
  if (nextActionDigest === input.proposal.actionDigest) {
    return {
      request: input.request,
      invalidated: false,
      nextActionDigest,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }

  const notExpired = expireApprovalRequest(input.request, input.now);
  if (notExpired.state === "expired") {
    return {
      request: notExpired,
      invalidated: false,
      nextActionDigest,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }

  const invalidatedRequest = invalidateApprovalRequest(notExpired);
  return {
    request: invalidatedRequest,
    invalidated: invalidatedRequest !== notExpired,
    nextActionDigest,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}
