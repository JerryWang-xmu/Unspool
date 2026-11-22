import type { B0NodeReceipt } from "../../../../packages/test-support/src/federation/fixtures.js";

export function inspectNodeInjection(_receipt: B0NodeReceipt): {
  allowedExecution: false;
  grantProposalRequired: true;
  reviewState: "review_required";
} {
  return {
    allowedExecution: false,
    grantProposalRequired: true,
    reviewState: "review_required",
  };
}

export function createInjectionReview(input: {
  conclusionId: string;
  receipt: B0NodeReceipt;
  reviewerId: string;
  reviewedAt: string;
}) {
  return {
    id: `injection-review-${input.receipt.eventId}`,
    conclusionId: input.conclusionId,
    previousState: "unverified",
    newState: "review_required",
    reason: `Untrusted node output requires independent evidence review: ${input.receipt.reason}`,
    sourceVersionIds: [input.receipt.resourceDigest],
    reviewedBy: input.reviewerId,
    reviewedAt: input.reviewedAt,
    verifiedBusinessFact: false,
  };
}
