import {
  type ActionEnvelope,
  type ActionProposal,
  computeActionDigest,
} from "../../domain/src/action-proposal.js";
import type { ApprovalDecision } from "../../domain/src/approval-decision.js";
import { type ApprovalRequest, isApprovalExpired } from "../../domain/src/approval-request.js";
import {
  consumeExecutionPermit as consumeDomainExecutionPermit,
  type ExecutionPermit,
  type PermitConsumptionOutcome,
  type PermitErrorCode,
} from "../../domain/src/execution-permit.js";

export interface ExecuteWithApprovalInput {
  readonly permit: ExecutionPermit;
  readonly actionDigest: string;
  readonly runAttemptId: string;
  readonly policyRevision: number;
  readonly execute: () => void | Promise<void>;
  readonly now?: Date;
}

export interface ExecuteWithApprovalResult {
  readonly status: "consumed";
  readonly permit: ExecutionPermit;
}

export class ApprovalGateError extends Error {
  readonly code: PermitErrorCode | "approval_invalid";

  constructor(code: PermitErrorCode | "approval_invalid", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApprovalGateError";
    this.code = code;
  }
}

/**
 * The last check before a real tool side effect. The permit is consumed before
 * `execute` is invoked, so a concurrent or replayed call cannot repeat the
 * effect. If execution fails after consumption the permit stays consumed with
 * an `outcome_unknown` result and is never replayable.
 */
export async function executeWithApproval(
  input: ExecuteWithApprovalInput,
): Promise<ExecuteWithApprovalResult> {
  const consumption = consumeDomainExecutionPermit({
    permit: input.permit,
    actionDigest: input.actionDigest,
    runAttemptId: input.runAttemptId,
    policyRevision: input.policyRevision,
    now: input.now ?? new Date(),
    consumptionResult: "outcome_unknown",
  });

  if (consumption.status === "rejected") {
    throw new ApprovalGateError(
      consumption.error?.code ?? "approval_invalid",
      consumption.error?.message ?? "Execution permit is no longer valid",
    );
  }

  Object.assign(input.permit, consumption.permit);

  try {
    await input.execute();
  } catch (error) {
    throw new ApprovalGateError(
      "outcome_unknown",
      "Tool execution failed after the permit was consumed; the outcome is unknown",
      { cause: error },
    );
  }

  Object.assign(input.permit, { consumptionResult: "succeeded" });

  return { status: "consumed", permit: input.permit };
}

/** Persisted approval state re-read at the side-effect edge. */
export interface ApprovalRecord {
  readonly request: ApprovalRequest;
  readonly proposal: ActionProposal;
  readonly decision?: ApprovalDecision | undefined;
  readonly permit?: ExecutionPermit | undefined;
}

export interface ApprovalGateDependencies {
  readonly now: () => Date;
  readonly loadApproval: (
    approvalId: string,
  ) => Promise<ApprovalRecord | undefined> | ApprovalRecord | undefined;
  readonly invalidateApproval: (approvalId: string, reason: string) => Promise<void> | void;
  readonly savePermit: (permit: ExecutionPermit) => Promise<void> | void;
  /** Durable conditional consume; a replay must reject rather than overwrite. */
  readonly consumePermit: (permit: ExecutionPermit) => ExecutionPermit | Promise<ExecutionPermit>;
}

export type ApprovalBlockCode =
  | "approval_required"
  | "approval_invalid"
  | "already_consumed"
  | "run_stopping";

export interface AuthorizeToolRequest {
  readonly approvalId: string;
  readonly action: ActionEnvelope;
  readonly actionDigest: string;
  readonly runAttemptId: string;
  readonly policyRevision: number;
  readonly runState?: "running" | "stopping" | undefined;
}

export type AuthorizeToolResult =
  | {
      readonly status: "authorized";
      readonly permit: ExecutionPermit;
      readonly effectiveArgsDigest: string;
    }
  | {
      readonly status: "blocked";
      readonly code: ApprovalBlockCode;
      readonly reason: string;
    };

export interface ApprovalGate {
  authorize(input: AuthorizeToolRequest): Promise<AuthorizeToolResult>;
  finalizePermit(permit: ExecutionPermit, outcome: PermitConsumptionOutcome): Promise<void>;
  now(): Date;
}

/**
 * Builds the side-effect gate used by the tool wrapper. `authorize` re-reads
 * the persisted approval, re-binds the effective action digest, and consumes
 * the single-use permit before the wrapper may invoke the real tool. Every
 * refusal path leaves the tool uninvoked.
 */
export function createApprovalGate(dependencies: ApprovalGateDependencies): ApprovalGate {
  return {
    now: dependencies.now,

    async authorize(input) {
      if (input.runState === "stopping") {
        return blocked("run_stopping", "Run is stopping; no tool side effect is allowed");
      }

      let record: ApprovalRecord | undefined;
      try {
        record = await dependencies.loadApproval(input.approvalId);
      } catch {
        return blocked(
          "approval_invalid",
          "Approval could not be re-read; no side effect is allowed",
        );
      }

      if (record === undefined) {
        return blocked("approval_invalid", "Approval request does not exist");
      }

      const { request, proposal, decision, permit } = record;

      if (request.id !== input.approvalId) {
        return blocked(
          "approval_invalid",
          "Loaded approval does not match the requested approval id",
        );
      }

      if (request.actionProposalId !== proposal.id) {
        return blocked(
          "approval_invalid",
          "Approval request does not reference the loaded action proposal",
        );
      }

      const effectiveArgsDigest = tryComputeActionDigest(input.action);
      if (effectiveArgsDigest === undefined) {
        return blocked("approval_invalid", "Effective action is not canonicalizable");
      }
      if (effectiveArgsDigest !== input.actionDigest) {
        return blocked(
          "approval_invalid",
          "Effective action digest does not match the announced tool call",
        );
      }

      if (effectiveArgsDigest !== proposal.actionDigest) {
        await invalidateChangedAction(dependencies, request.id);
        return blocked("approval_invalid", "Action content or scope changed after approval");
      }

      if (input.policyRevision !== request.policyRevision) {
        return blocked("approval_invalid", "Policy revision changed after approval");
      }

      if (request.state === "expired" || isApprovalExpired(request, dependencies.now())) {
        return blocked("approval_invalid", "Approval request is expired");
      }

      if (request.state === "rejected") {
        return blocked(
          "approval_invalid",
          decision?.reason ?? "Approval request was rejected; the action must not execute",
        );
      }

      if (request.state === "invalidated") {
        return blocked("approval_invalid", "Approval request was invalidated");
      }

      if (request.state === "pending") {
        return blocked("approval_required", "Approval is still pending");
      }

      if (
        decision === undefined ||
        decision.decision !== "approved" ||
        decision.approvalRequestId !== request.id ||
        decision.actionDigest !== proposal.actionDigest
      ) {
        return blocked("approval_invalid", "Approval decision does not authorize this action");
      }

      if (permit === undefined) {
        return blocked("approval_invalid", "Approved request has no execution permit");
      }

      if (permit.consumedAt !== undefined) {
        return blocked(
          "already_consumed",
          permit.consumptionResult === "outcome_unknown"
            ? "Execution permit was consumed and the outcome is unknown"
            : "Execution permit has already been consumed",
        );
      }

      const consumption = consumeDomainExecutionPermit({
        permit,
        actionDigest: effectiveArgsDigest,
        runAttemptId: input.runAttemptId,
        policyRevision: input.policyRevision,
        now: dependencies.now(),
        consumptionResult: "outcome_unknown",
      });

      if (consumption.status === "rejected") {
        return blocked(
          mapPermitError(consumption.error?.code),
          consumption.error?.message ?? "Execution permit is no longer valid",
        );
      }

      let consumedPermit: ExecutionPermit;
      try {
        consumedPermit = await dependencies.consumePermit(consumption.permit);
      } catch (error) {
        if (error instanceof ApprovalGateError) {
          return blocked(mapPermitError(error.code), error.message);
        }
        return blocked(
          "approval_invalid",
          "Execution permit could not be consumed atomically; no tool side effect was allowed",
        );
      }
      if (consumedPermit.consumedAt === undefined) {
        return blocked("approval_invalid", "Execution permit was not consumed atomically");
      }

      return {
        status: "authorized",
        permit: consumedPermit,
        effectiveArgsDigest,
      };
    },

    async finalizePermit(permit, outcome) {
      await dependencies.savePermit({ ...permit, consumptionResult: outcome });
    },
  };
}

async function invalidateChangedAction(
  dependencies: ApprovalGateDependencies,
  approvalId: string,
): Promise<void> {
  try {
    await dependencies.invalidateApproval(
      approvalId,
      "The effective action no longer matches the approved action digest",
    );
  } catch {
    // The digest mismatch already blocks; a failed invalidation write must not
    // turn into permission to execute.
  }
}

function blocked(code: ApprovalBlockCode, reason: string): AuthorizeToolResult {
  return { status: "blocked", code, reason };
}

function tryComputeActionDigest(action: ActionEnvelope): string | undefined {
  try {
    return computeActionDigest(action);
  } catch {
    return undefined;
  }
}

function mapPermitError(code: PermitErrorCode | undefined): ApprovalBlockCode {
  if (code === "already_consumed" || code === "outcome_unknown") {
    return "already_consumed";
  }

  return "approval_invalid";
}
