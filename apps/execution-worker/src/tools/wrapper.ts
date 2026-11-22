import type { ActionEnvelope } from "../../../../packages/domain/src/action-proposal.js";
import type {
  ApprovalBlockCode,
  ApprovalGate,
} from "../../../../packages/pi-adapter/src/approval-gate.js";
import {
  createToolExecutionEnteredReceipt,
  createToolFinalizedReceipt,
  type ToolExecutionReceipt,
} from "../../../../packages/pi-adapter/src/tool-receipts.js";

export interface ExecuteGuardedToolInput<T> {
  readonly gate: ApprovalGate;
  readonly approvalId: string;
  readonly action: ActionEnvelope;
  readonly actionDigest: string;
  readonly runAttemptId: string;
  readonly policyRevision: number;
  readonly runState?: "running" | "stopping" | undefined;
  readonly simulateResponseLoss?: boolean | undefined;
  readonly toolCallId?: string | undefined;
  readonly parentToolCallId?: string | undefined;
  readonly invoke: () => T | Promise<T>;
}

export interface BlockedToolExecution {
  readonly status: "blocked";
  readonly code: ApprovalBlockCode;
  readonly reason: string;
  readonly receipts: readonly ToolExecutionReceipt[];
}

export interface SucceededToolExecution<T> {
  readonly status: "succeeded";
  readonly result: T;
  readonly receipts: readonly ToolExecutionReceipt[];
}

export interface UnknownToolExecution {
  readonly status: "outcome_unknown";
  readonly code: "outcome_unknown";
  readonly reason: string;
  readonly receipts: readonly ToolExecutionReceipt[];
}

export type ExecuteGuardedToolResult<T> =
  | BlockedToolExecution
  | SucceededToolExecution<T>
  | UnknownToolExecution;

/**
 * The only path from an approved tool call to a real side effect. The gate is
 * consulted first and a refusal returns without calling `invoke`; a permit is
 * consumed and persisted before the entered receipt is emitted.
 */
export async function executeGuardedTool<T>(
  input: ExecuteGuardedToolInput<T>,
): Promise<ExecuteGuardedToolResult<T>> {
  const authorization = await input.gate.authorize({
    approvalId: input.approvalId,
    action: input.action,
    actionDigest: input.actionDigest,
    runAttemptId: input.runAttemptId,
    policyRevision: input.policyRevision,
    ...(input.runState === undefined ? {} : { runState: input.runState }),
  });

  if (authorization.status === "blocked") {
    return {
      status: "blocked",
      code: authorization.code,
      reason: authorization.reason,
      receipts: [],
    };
  }

  const receiptTarget = {
    effectiveArgsDigest: authorization.effectiveArgsDigest,
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.parentToolCallId === undefined ? {} : { parentToolCallId: input.parentToolCallId }),
  };

  const entered = createToolExecutionEnteredReceipt({
    ...receiptTarget,
    observedAt: input.gate.now(),
  });

  let result: T;
  try {
    result = await input.invoke();
  } catch {
    return {
      status: "outcome_unknown",
      code: "outcome_unknown",
      reason: "Tool failed after execution entered; the outcome is unknown",
      receipts: [entered],
    };
  }

  if (input.simulateResponseLoss === true) {
    return {
      status: "outcome_unknown",
      code: "outcome_unknown",
      reason: "Tool completed after execution entered but its response was lost",
      receipts: [entered],
    };
  }

  try {
    await input.gate.finalizePermit(authorization.permit, "succeeded");
  } catch {
    return {
      status: "outcome_unknown",
      code: "outcome_unknown",
      reason:
        "Tool completed after execution entered but its permit outcome could not be persisted",
      receipts: [entered],
    };
  }

  const finalized = createToolFinalizedReceipt({
    ...receiptTarget,
    observedAt: input.gate.now(),
    outcome: "succeeded",
  });

  return {
    status: "succeeded",
    result,
    receipts: [entered, finalized],
  };
}
