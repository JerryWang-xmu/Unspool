import { integer, object, optionalText, optionalTimestamp, text } from "./validation.js";

export const CONCLUSION_KINDS = ["fact", "assumption", "decision"] as const;
export const CONCLUSION_STATES = ["unverified", "confirmed", "review_required", "invalid"] as const;
export type ConclusionKind = (typeof CONCLUSION_KINDS)[number];
export type ConclusionState = (typeof CONCLUSION_STATES)[number];

export interface Conclusion {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ConclusionKind;
  readonly body: string;
  readonly state: ConclusionState;
  readonly scope: string;
  readonly proposedBy: string;
  readonly confirmedBy?: string | undefined;
  readonly confirmedAt?: string | undefined;
  readonly currentVersion: number;
  readonly lastReviewedAt?: string | undefined;
}

export function parseConclusion(value: unknown): Conclusion {
  const input = object(value, "Conclusion");
  const kind = text(input.kind, "Conclusion.kind") as ConclusionKind;
  const state = text(input.state, "Conclusion.state") as ConclusionState;
  if (!CONCLUSION_KINDS.includes(kind)) throw new TypeError(`Unsupported Conclusion.kind: ${kind}`);
  if (!CONCLUSION_STATES.includes(state))
    throw new TypeError(`Unsupported Conclusion.state: ${state}`);
  return {
    id: text(input.id, "Conclusion.id"),
    workspaceId: text(input.workspaceId, "Conclusion.workspaceId"),
    kind,
    body: text(input.body, "Conclusion.body"),
    state,
    scope: text(input.scope, "Conclusion.scope"),
    proposedBy: text(input.proposedBy, "Conclusion.proposedBy"),
    ...(input.confirmedBy === undefined
      ? {}
      : { confirmedBy: optionalText(input.confirmedBy, "Conclusion.confirmedBy") }),
    ...(input.confirmedAt === undefined
      ? {}
      : { confirmedAt: optionalTimestamp(input.confirmedAt, "Conclusion.confirmedAt") }),
    currentVersion: integer(input.currentVersion, "Conclusion.currentVersion", 1),
    ...(input.lastReviewedAt === undefined
      ? {}
      : { lastReviewedAt: optionalTimestamp(input.lastReviewedAt, "Conclusion.lastReviewedAt") }),
  };
}

export function createProposedConclusion(
  input: Omit<Conclusion, "state" | "currentVersion">,
): Conclusion {
  return parseConclusion({ ...input, state: "unverified", currentVersion: 1 });
}
