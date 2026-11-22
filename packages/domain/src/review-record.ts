import { object, text, textArray, timestamp } from "./validation.js";
export interface ReviewRecord {
  id: string;
  conclusionId: string;
  previousState: string;
  newState: string;
  reason: string;
  sourceVersionIds: readonly string[];
  reviewedBy: string;
  reviewedAt: string;
}
export function createReviewRecord(input: ReviewRecord): ReviewRecord {
  const value = object(input, "ReviewRecord");
  return Object.freeze({
    id: text(value.id, "ReviewRecord.id"),
    conclusionId: text(value.conclusionId, "ReviewRecord.conclusionId"),
    previousState: text(value.previousState, "ReviewRecord.previousState"),
    newState: text(value.newState, "ReviewRecord.newState"),
    reason: text(value.reason, "ReviewRecord.reason"),
    sourceVersionIds: Object.freeze(
      textArray(value.sourceVersionIds, "ReviewRecord.sourceVersionIds"),
    ),
    reviewedBy: text(value.reviewedBy, "ReviewRecord.reviewedBy"),
    reviewedAt: timestamp(value.reviewedAt, "ReviewRecord.reviewedAt"),
  });
}
