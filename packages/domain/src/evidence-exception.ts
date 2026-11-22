import { object, text, textArray, timestamp } from "./validation.js";
export interface EvidenceException {
  id: string;
  runId: string;
  conclusionIds: readonly string[];
  reason: string;
  approvedBy: string;
  createdAt: string;
}
export function createEvidenceException(input: EvidenceException): EvidenceException {
  const value = object(input, "EvidenceException");
  const conclusionIds = textArray(value.conclusionIds, "EvidenceException.conclusionIds");
  if (conclusionIds.length === 0)
    throw new RangeError("EvidenceException.conclusionIds must not be empty");
  return Object.freeze({
    id: text(value.id, "EvidenceException.id"),
    runId: text(value.runId, "EvidenceException.runId"),
    conclusionIds: Object.freeze(conclusionIds),
    reason: text(value.reason, "EvidenceException.reason"),
    approvedBy: text(value.approvedBy, "EvidenceException.approvedBy"),
    createdAt: timestamp(value.createdAt, "EvidenceException.createdAt"),
  });
}
