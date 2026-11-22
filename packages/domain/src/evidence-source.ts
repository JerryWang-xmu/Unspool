import { object, optionalTimestamp, text, timestamp } from "./validation.js";
export const EVIDENCE_SOURCE_STATES = [
  "active",
  "review_required",
  "superseded",
  "revoked",
  "invalid",
  "unavailable",
] as const;
export type EvidenceSourceState = (typeof EVIDENCE_SOURCE_STATES)[number];
export interface EvidenceSource {
  id: string;
  workspaceId: string;
  originType: "artifact" | "context" | "external" | "member_input";
  originId: string;
  currentVersionId: string;
  state: EvidenceSourceState;
  lastConfirmedAt: string;
  reviewDueAt?: string | undefined;
  externalMonitoring: boolean;
}
export function parseEvidenceSource(value: unknown): EvidenceSource {
  const input = object(value, "EvidenceSource");
  const state = text(input.state, "EvidenceSource.state") as EvidenceSourceState;
  if (!EVIDENCE_SOURCE_STATES.includes(state))
    throw new TypeError(`Unsupported EvidenceSource.state: ${state}`);
  return {
    id: text(input.id, "EvidenceSource.id"),
    workspaceId: text(input.workspaceId, "EvidenceSource.workspaceId"),
    originType: text(input.originType, "EvidenceSource.originType") as EvidenceSource["originType"],
    originId: text(input.originId, "EvidenceSource.originId"),
    currentVersionId: text(input.currentVersionId, "EvidenceSource.currentVersionId"),
    state,
    lastConfirmedAt: timestamp(input.lastConfirmedAt, "EvidenceSource.lastConfirmedAt"),
    ...(input.reviewDueAt === undefined
      ? {}
      : { reviewDueAt: optionalTimestamp(input.reviewDueAt, "EvidenceSource.reviewDueAt") }),
    externalMonitoring: input.externalMonitoring === true,
  };
}
export function createEvidenceSource(input: EvidenceSource): EvidenceSource {
  return parseEvidenceSource(input);
}
