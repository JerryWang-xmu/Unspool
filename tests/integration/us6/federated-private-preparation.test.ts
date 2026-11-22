import { afterEach, describe, expect, it } from "vitest";
import { answerFederatedPreparationQuestion } from "../../../apps/runner-api/src/handoffs/federated-answer-service";
import { createFederationHarness } from "../../../packages/test-support/src/federation/harness";
import { expectOk } from "../../support/federation";

let harness: Awaited<ReturnType<typeof createFederationHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("federated private preparation permissions", () => {
  it("never borrows another recipient's Grant and never leaks excluded source bodies", async () => {
    harness = await createFederationHarness();
    const { fixture, grants } = harness;
    const recipientId = "recipient";
    const ownerId = fixture.grants.active.ownerId;
    expectOk(grants.registerOwner(ownerId));
    const pending = expectOk(
      grants.propose({
        ...fixture.grants.active,
        recipientRules: { ...fixture.grants.active.recipientRules, recipientIds: [recipientId] },
        rights: { ...fixture.grants.active.rights, memberDisclose: true },
        state: undefined,
        ownerSignature: undefined,
        revocationTombstone: undefined,
      }),
    );
    const sharedGrant = expectOk(grants.decide(pending.id, "active"));
    const privatePending = expectOk(
      grants.propose({
        ...fixture.grants.active,
        id: "private-grant",
        recipientRules: { ...fixture.grants.active.recipientRules, recipientIds: ["someone-else"] },
        state: undefined,
        ownerSignature: undefined,
        revocationTombstone: undefined,
      }),
    );
    const privateGrant = expectOk(grants.decide(privatePending.id, "active"));
    const sharedSource = {
      sourceType: "context" as const,
      sourceId: sharedGrant.resourceId,
      sourceRevision: 1,
      title: "Shared decision",
      body: "Shared approved body",
      recordedAt: fixture.now,
      contentDigest: sharedGrant.resourceDigest,
      grant: sharedGrant,
    };
    const secretCanary = "FEDERATED-PRIVATE-CANARY";
    const privateSource = {
      sourceType: "context" as const,
      sourceId: privateGrant.resourceId,
      sourceRevision: 1,
      title: "Other recipient source",
      body: secretCanary,
      recordedAt: fixture.now,
      contentDigest: privateGrant.resourceDigest,
      grant: privateGrant,
    };
    const answer = answerFederatedPreparationQuestion({
      question: "[US4:SOURCED] What is the shared decision?",
      actorId: recipientId,
      now: new Date(fixture.now),
      sources: [sharedSource, privateSource],
      verifyGrant: (grant) => grants.verify(grant.id).value,
    });
    expect(answer.answerKind).toBe("sourced");
    expect(answer.answer).toBe("Shared approved body");
    expect(JSON.stringify(answer)).not.toContain(secretCanary);

    const denied = answerFederatedPreparationQuestion({
      question: "[US4:PRIVATE] Summarize the other recipient source",
      actorId: recipientId,
      now: new Date(fixture.now),
      sources: [privateSource],
      verifyGrant: (grant) => grants.verify(grant.id).value,
    });
    expect(denied.answerKind).toBe("permission_denied");
    expect(JSON.stringify(denied)).not.toContain(secretCanary);
    const unknown = answerFederatedPreparationQuestion({
      question: "What does the other source say?",
      actorId: "unrelated-recipient",
      now: new Date(fixture.now),
      sources: [sharedSource, privateSource],
      verifyGrant: (grant) => grants.verify(grant.id).value,
    });
    expect(unknown.answerKind).toBe("unknown");
    expect(JSON.stringify(unknown)).not.toContain(secretCanary);

    expectOk(grants.decide(sharedGrant.id, "revoked"));
    const revoked = answerFederatedPreparationQuestion({
      question: "[US4:SOURCED] What is the shared decision?",
      actorId: recipientId,
      now: new Date(fixture.now),
      sources: [sharedSource],
      verifyGrant: (grant) => grants.verify(grant.id).value,
    });
    expect(revoked.answerKind).toBe("unknown");
    expect(revoked.answer).not.toContain("Shared approved body");
  });
});
