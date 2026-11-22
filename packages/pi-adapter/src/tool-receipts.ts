export type ToolReceiptKind = "tool_execution_entered" | "tool_finalized";

export type ToolReceiptOutcome = "succeeded" | "outcome_unknown";

/**
 * Receipt emitted at the real side-effect edge, never from pi's preflight
 * `tool_execution_start` notification. The effective args digest binds the
 * receipt to the exact action that crossed the approval boundary.
 */
export interface ToolExecutionReceipt {
  readonly kind: ToolReceiptKind;
  readonly observedAt: string;
  readonly effectiveArgsDigest: string;
  readonly toolCallId?: string | undefined;
  readonly parentToolCallId?: string | undefined;
  readonly outcome?: ToolReceiptOutcome | undefined;
}

export interface ToolExecutionReceiptInput {
  readonly effectiveArgsDigest: string;
  readonly observedAt: Date;
  readonly toolCallId?: string | undefined;
  readonly parentToolCallId?: string | undefined;
}

export interface ToolFinalizedReceiptInput extends ToolExecutionReceiptInput {
  readonly outcome: ToolReceiptOutcome;
}

export function createToolExecutionEnteredReceipt(
  input: ToolExecutionReceiptInput,
): ToolExecutionReceipt {
  return {
    kind: "tool_execution_entered",
    observedAt: input.observedAt.toISOString(),
    effectiveArgsDigest: input.effectiveArgsDigest,
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.parentToolCallId === undefined ? {} : { parentToolCallId: input.parentToolCallId }),
  };
}

export function createToolFinalizedReceipt(input: ToolFinalizedReceiptInput): ToolExecutionReceipt {
  return {
    kind: "tool_finalized",
    observedAt: input.observedAt.toISOString(),
    effectiveArgsDigest: input.effectiveArgsDigest,
    outcome: input.outcome,
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.parentToolCallId === undefined ? {} : { parentToolCallId: input.parentToolCallId }),
  };
}
