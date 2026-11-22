import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  ActionProposal,
  ActionProposalView,
} from "../../../../packages/domain/src/action-proposal.js";
import { toActionProposalView } from "../../../../packages/domain/src/action-proposal.js";
import type { ApprovalDecision } from "../../../../packages/domain/src/approval-decision.js";
import type {
  ApprovalRequest,
  ApprovalRequestState,
  RequiredApproverPolicy,
} from "../../../../packages/domain/src/approval-request.js";
import {
  type ApprovalServiceAudit,
  type DecideApprovalServiceResult,
  decideApproval,
} from "../approvals/service.js";
import { type ProblemCode, sendProblem } from "../errors/problem.js";

export interface StoredApproval {
  readonly request: ApprovalRequest;
  readonly proposal: ActionProposal;
  readonly workspaceId?: string;
  readonly decision?: ApprovalDecision;
  readonly audit?: ApprovalServiceAudit;
}

export interface ApprovalStore {
  readonly get: (
    approvalId: string,
  ) => StoredApproval | undefined | Promise<StoredApproval | undefined>;
  readonly list: () => readonly StoredApproval[] | Promise<readonly StoredApproval[]>;
  readonly save: (record: StoredApproval) => void | Promise<void>;
  readonly decidePending?: ((record: StoredApproval) => void | Promise<void>) | undefined;
}

export interface ApprovalView {
  readonly id: string;
  readonly actionProposal: ActionProposalView;
  readonly requesterId: string;
  readonly requiredApproverPolicy: RequiredApproverPolicy;
  readonly policyRevision: number;
  readonly state: ApprovalRequestState;
  readonly workspaceId?: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly decidedBy?: string;
  readonly reason?: string;
}

export interface ApprovalRouteOptions {
  readonly store: ApprovalStore;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
  readonly now?: () => Date;
  readonly onApproved?: ((record: StoredApproval) => void | Promise<void>) | undefined;
}

type DecisionBody = {
  readonly decision: "approved" | "rejected";
  readonly actionDigest: string;
  readonly reason?: string;
};

export function createInMemoryApprovalStore(
  initial: readonly StoredApproval[] = [],
): ApprovalStore {
  const records = new Map(initial.map((record) => [record.request.id, record]));

  return {
    get: (approvalId) => records.get(approvalId),
    list: () => [...records.values()],
    save: (record) => {
      records.set(record.request.id, record);
    },
  };
}

/**
 * Approval list/detail/decision endpoints. Responses are built from the
 * secret-free action proposal projection; `canonicalArgs` never crosses this
 * boundary.
 */
export function registerApprovalRoutes(app: FastifyInstance, options: ApprovalRouteOptions): void {
  const now = options.now ?? (() => new Date());

  app.get("/v1/approvals", async (request, reply) => {
    const actorId = await resolveActorId(options, request);
    if (actorId === null) {
      return sendProblem(reply, "unauthenticated");
    }

    return {
      items: (await options.store.list())
        .filter((record) => canReadApproval(actorId, record))
        .map(toApprovalView),
    };
  });

  app.get<{ Params: { approvalId: string } }>(
    "/v1/approvals/:approvalId",
    async (request, reply) => {
      const actorId = await resolveActorId(options, request);
      if (actorId === null) {
        return sendProblem(reply, "unauthenticated");
      }

      const record = await findVisibleApproval(options.store, actorId, request.params.approvalId);
      if (record === undefined) {
        return sendProblem(reply, "not_found");
      }

      return toApprovalView(record);
    },
  );

  app.post<{ Params: { approvalId: string }; Body: unknown }>(
    "/v1/approvals/:approvalId/decision",
    async (request, reply) => {
      const actorId = await resolveActorId(options, request);
      if (actorId === null) {
        return sendProblem(reply, "unauthenticated");
      }

      const body = parseDecisionBody(request.body);
      if (body === null) {
        return sendProblem(reply, "invalid_request", {
          detail: "A decision of approved or rejected and the current action digest are required.",
        });
      }

      const record = await options.store.get(request.params.approvalId);
      if (record === undefined) {
        return sendProblem(reply, "not_found");
      }
      if (!canReadApproval(actorId, record)) {
        return sendProblem(reply, "permission_denied");
      }

      const outcome = decideApproval({
        request: record.request,
        proposal: record.proposal,
        actorId,
        decision: body.decision,
        actionDigest: body.actionDigest,
        now: now(),
        approverPolicy: record.request.requiredApproverPolicy,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      });

      if (outcome.error !== undefined && outcome.decision === undefined) {
        if (options.store.decidePending !== undefined) {
          await options.store.decidePending(withOutcome(outcome, record.workspaceId));
        } else {
          await options.store.save(withOutcome(outcome, record.workspaceId));
        }
        return sendProblem(reply, problemCodeFor(outcome.error.code), {
          detail: outcome.error.message,
        });
      }

      if (outcome.decision === undefined) {
        return sendProblem(reply, "approval_invalid", {
          detail: "Approval decision could not be recorded.",
        });
      }

      const saved = withOutcome(outcome, record.workspaceId);
      if (options.store.decidePending !== undefined) {
        await options.store.decidePending(saved);
      } else {
        await options.store.save(saved);
      }
      if (outcome.decision.decision === "approved" && options.onApproved !== undefined) {
        await options.onApproved(saved);
      }
      return toApprovalView(saved);
    },
  );
}

export function toApprovalView(record: StoredApproval): ApprovalView {
  const { request, decision } = record;

  return {
    id: request.id,
    actionProposal: toActionProposalView(record.proposal),
    requesterId: request.requesterId,
    requiredApproverPolicy: request.requiredApproverPolicy,
    policyRevision: request.policyRevision,
    state: request.state,
    ...(record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId }),
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    ...(decision === undefined
      ? {}
      : {
          decidedBy: decision.decidedBy,
          ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        }),
  };
}

function withOutcome(outcome: DecideApprovalServiceResult, workspaceId?: string): StoredApproval {
  return {
    request: outcome.request,
    proposal: outcome.proposal,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(outcome.decision === undefined ? {} : { decision: outcome.decision }),
    ...(outcome.audit === undefined ? {} : { audit: outcome.audit }),
  };
}

function canReadApproval(actorId: string, record: StoredApproval): boolean {
  const policy = record.request.requiredApproverPolicy;

  return (
    record.request.requesterId === actorId ||
    policy.approverIds.includes(actorId) ||
    policy.singleUserException?.approvedBy === actorId
  );
}

async function findVisibleApproval(
  store: ApprovalStore,
  actorId: string,
  approvalId: string,
): Promise<StoredApproval | undefined> {
  const record = await store.get(approvalId);

  if (record === undefined || !canReadApproval(actorId, record)) {
    return undefined;
  }

  return record;
}

async function resolveActorId(
  options: ApprovalRouteOptions,
  request: FastifyRequest,
): Promise<string | null> {
  const actorId = await options.resolveActorId(request);

  return actorId !== null && actorId.trim().length > 0 ? actorId : null;
}

function parseDecisionBody(value: unknown): DecisionBody | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const body = value as Record<string, unknown>;
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return null;
  }

  if (typeof body.actionDigest !== "string" || body.actionDigest.length === 0) {
    return null;
  }

  if (body.reason !== undefined && typeof body.reason !== "string") {
    return null;
  }

  return {
    decision: body.decision,
    actionDigest: body.actionDigest,
    ...(typeof body.reason === "string" && body.reason.length > 0 ? { reason: body.reason } : {}),
  };
}

function problemCodeFor(code: string): ProblemCode {
  switch (code) {
    case "not_approver":
    case "self_approval_not_allowed":
      return "permission_denied";
    case "invalid_decision":
      return "invalid_request";
    default:
      return "approval_invalid";
  }
}
