import { object, text, timestamp } from "./validation.js";

export const CLARIFICATION_TARGET_TYPES = ["discussion", "context", "handoff_note"] as const;
export const CLARIFICATION_PUBLICATION_TARGET_TYPES = CLARIFICATION_TARGET_TYPES;
export type ClarificationTargetType = (typeof CLARIFICATION_TARGET_TYPES)[number];

/**
 * A published clarification always contains the recipient's edited body. The
 * raw private question and answer remain private.
 */
export interface ClarificationPublication {
  readonly id: string;
  readonly preparationSessionId: string;
  readonly targetType: ClarificationTargetType;
  readonly targetId: string;
  readonly editedBody: string;
  readonly publishedBy: string;
  readonly publishedAt: string;
}

export interface CreateClarificationPublicationInput {
  readonly id: string;
  readonly preparationSessionId: string;
  readonly targetType: ClarificationTargetType;
  readonly targetId: string;
  readonly editedBody: string;
  readonly publishedBy: string;
  readonly publishedAt: string;
}

export function parseClarificationPublication(value: unknown): ClarificationPublication {
  const input = object(value, "ClarificationPublication");
  const targetType = text(
    input.targetType,
    "ClarificationPublication.targetType",
  ) as ClarificationTargetType;
  if (!CLARIFICATION_TARGET_TYPES.includes(targetType)) {
    throw new TypeError(`Unsupported ClarificationPublication.targetType: ${targetType}`);
  }
  return Object.freeze({
    id: text(input.id, "ClarificationPublication.id"),
    preparationSessionId: text(
      input.preparationSessionId,
      "ClarificationPublication.preparationSessionId",
    ),
    targetType,
    targetId: text(input.targetId, "ClarificationPublication.targetId"),
    editedBody: text(input.editedBody, "ClarificationPublication.editedBody"),
    publishedBy: text(input.publishedBy, "ClarificationPublication.publishedBy"),
    publishedAt: timestamp(input.publishedAt, "ClarificationPublication.publishedAt"),
  });
}

export function createClarificationPublication(
  input: CreateClarificationPublicationInput,
): ClarificationPublication {
  return parseClarificationPublication(input);
}
