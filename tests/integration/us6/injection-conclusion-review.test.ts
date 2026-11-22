import { afterEach, describe, expect, it } from "vitest";
import { createFederationHarness } from "../../../packages/test-support/src/federation/harness.js";
import { expectError, expectOk } from "../../support/federation.js";

let harness: Awaited<ReturnType<typeof createFederationHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});
async function subject() {
  harness ??= await createFederationHarness();
  return harness;
}

describe("US6 untrusted-node injection review", () => {
  it("turns injection-shaped output into an evidence review, never execution", async () => {
    const { fixture, injection } = await subject();
    const inspected = expectOk(injection.inspect(fixture.maliciousNode.forgedSuccess));
    expect(inspected.allowedExecution).toBe(false);
    expect(inspected.grantProposalRequired).toBe(true);
    const review = expectOk(
      injection.review({
        conclusionId: "conclusion-1",
        receipt: fixture.maliciousNode.forgedSuccess,
        reviewerId: "owner",
        reviewedAt: fixture.now,
      }),
    );
    expect(review.newState).toBe("review_required");
    expect(review.verifiedBusinessFact).toBe(false);
    expect(review.sourceVersionIds).toContain(fixture.maliciousNode.forgedSuccess.resourceDigest);
  });

  it("retains only read-only handoff grants and requires high-risk reconfirmation", async () => {
    const { fixture, handoffs } = await subject();
    const prepared = expectOk(handoffs.prepare([fixture.grants.active]));
    expect(prepared.grants[0]?.operations).toEqual(["snapshot.read"]);
    expect(prepared.privateDataInherited).toBe(false);
    expect(prepared.privateReassignment).toBe(false);
    expectError(
      handoffs.accept({ highRisk: true, sourceReconfirmed: true, recipientReconfirmed: false }),
      "high_risk_reconfirmation_required",
    );
    expectOk(
      handoffs.accept({ highRisk: true, sourceReconfirmed: true, recipientReconfirmed: true }),
    );
  });
});
