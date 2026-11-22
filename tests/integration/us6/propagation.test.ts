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

describe("US6 propagation and label intersection", () => {
  it("derives only the strict intersection and requires owner review for narrowing", async () => {
    const { labels, b1 } = await subject();
    const rights = {
      modelDisclose: false,
      memberDisclose: false,
      publicTimeline: false,
      domainPropagate: true,
      centralCache: false,
      offlineRead: false,
    };
    const derived = expectOk(labels.derive(rights, rights, rights));
    expect(derived.rights).toEqual(rights);
    expect(derived.rights.modelDisclose).toBe(false);
    expect(derived.rights.memberDisclose).toBe(false);
    expect(derived.rights.publicTimeline).toBe(false);
    expect(derived.rights.domainPropagate).toBe(true);
    expect(derived.rights.centralCache).toBe(false);
    expect(derived.rights.offlineRead).toBe(false);
    const narrowed = expectOk(labels.derive({ ...rights, memberDisclose: true }, rights, rights));
    expect(narrowed.ownerReviewRequired).toBe(true);
    expect(narrowed.reviewVersion).toBe(2);
    expect(b1.B1_CROSS_DOMAIN_DERIVED_LABEL.publicVisibility).toBe(false);
  });

  it("keeps cross-domain Artifact transfer disabled in the read-only B0 gate", async () => {
    const { artifacts, b1 } = await subject();
    expectError(
      artifacts.transfer({
        artifact: b1.B1_CROSS_DOMAIN_ARTIFACT,
        recipient: b1.B1_CROSS_DOMAIN_RECIPIENT,
        sourceLabelRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
        recipientLabelRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
        requestedRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
        approvals: [b1.B1_CROSS_DOMAIN_SOURCE_APPROVAL, b1.B1_CROSS_DOMAIN_RECIPIENT_APPROVAL],
        federationLevel: "snapshot",
      }),
      "cross_domain_transfer_disabled",
    );
  });
});
