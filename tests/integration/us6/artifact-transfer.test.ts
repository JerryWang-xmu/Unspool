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

describe("US6 cross-domain Artifact transfer", () => {
  it("requires both owner approvals and returns only the derived payload", async () => {
    const { artifacts, b1 } = await subject();
    const result = expectOk(
      artifacts.transfer({
        artifact: b1.B1_CROSS_DOMAIN_ARTIFACT,
        recipient: b1.B1_CROSS_DOMAIN_RECIPIENT,
        sourceLabelRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
        recipientLabelRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
        requestedRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
        approvals: [b1.B1_CROSS_DOMAIN_SOURCE_APPROVAL, b1.B1_CROSS_DOMAIN_RECIPIENT_APPROVAL],
        federationLevel: "snapshot_tools_patch",
      }),
    );
    expect(result.payload).toEqual(b1.B1_CROSS_DOMAIN_TRANSFER.expectedPayload);
    expect(result.derivedSecurityLabel.rights.modelDisclose).toBe(false);
    expect(result.derivedSecurityLabel.rights.memberDisclose).toBe(false);
    expect(result.derivedSecurityLabel.rights.publicTimeline).toBe(false);
    expect(result.recipientArtifactVersions).toBe(1);
  });

  it("returns zero payload when recipient-owner approval is missing", async () => {
    const { artifacts, b1 } = await subject();
    const result = artifacts.transfer({
      artifact: b1.B1_CROSS_DOMAIN_ARTIFACT,
      recipient: b1.B1_CROSS_DOMAIN_RECIPIENT,
      sourceLabelRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
      recipientLabelRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
      requestedRights: b1.B1_CROSS_DOMAIN_TRANSFER.requestedRights,
      approvals: [b1.B1_CROSS_DOMAIN_SOURCE_APPROVAL],
      federationLevel: "snapshot_tools_patch",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("recipient_approval_required");
    expect(result.error.payloadBytes).toBe(0);
    expect(result.error.recipientArtifactVersions).toBe(0);
  });
});
