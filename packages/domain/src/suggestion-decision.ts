import { optionalText, text, timestamp } from "./validation.js";

export const SUGGESTION_DECISION_STATUSES = [
  "pending",
  "adopted",
  "edited_adopted",
  "ignored",
] as const;
export type SuggestionDecisionStatus = (typeof SUGGESTION_DECISION_STATUSES)[number];

/**
 * A suggestion retains both identities: `suggestedBy` is the author and
 * `decidedBy` is the current operator who adopted, edited or ignored it.
 */
export interface SuggestionDecision {
  readonly suggestionId: string;
  readonly suggestedBy: string;
  readonly status: SuggestionDecisionStatus;
  readonly decidedBy: string;
  readonly editedBody?: string;
  readonly resultingInputId?: string;
  readonly decidedAt: string;
}

export interface CreateSuggestionDecisionInput {
  readonly suggestionId: string;
  readonly suggestedBy: string;
  readonly status: SuggestionDecisionStatus;
  readonly decidedBy: string;
  readonly editedBody?: string;
  readonly resultingInputId?: string;
  readonly decidedAt: string;
}

function isSuggestionDecisionStatus(value: string): value is SuggestionDecisionStatus {
  return (SUGGESTION_DECISION_STATUSES as readonly string[]).includes(value);
}

export function createSuggestionDecision(input: CreateSuggestionDecisionInput): SuggestionDecision {
  if (!isSuggestionDecisionStatus(input.status)) {
    throw new RangeError(`Unsupported SuggestionDecision.status: ${String(input.status)}`);
  }
  const editedBody = optionalText(input.editedBody, "SuggestionDecision.editedBody");
  if (input.status === "edited_adopted" && editedBody === undefined) {
    throw new RangeError("edited_adopted requires an edited body");
  }

  return Object.freeze({
    suggestionId: text(input.suggestionId, "SuggestionDecision.suggestionId"),
    suggestedBy: text(input.suggestedBy, "SuggestionDecision.suggestedBy"),
    status: input.status,
    decidedBy: text(input.decidedBy, "SuggestionDecision.decidedBy"),
    ...(editedBody === undefined ? {} : { editedBody }),
    ...(input.resultingInputId === undefined
      ? {}
      : { resultingInputId: text(input.resultingInputId, "SuggestionDecision.resultingInputId") }),
    decidedAt: timestamp(input.decidedAt, "SuggestionDecision.decidedAt"),
  });
}
