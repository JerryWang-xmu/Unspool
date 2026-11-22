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

describe("US6 Patch application", () => {
  it("applies a matching base independently and journals a new version", async () => {
    const { patches, b1 } = await subject();
    const proposal = expectOk(
      patches.propose({ ...b1.B1_PATCH_PROPOSAL, patchDigest: undefined, state: undefined }),
    );
    const result = expectOk(
      patches.apply({
        proposal,
        independentGrantId: b1.B1_PATCH_APPLICATION.independentGrantId,
        currentFileDigests: { "src/example.ts": b1.B1_DIGESTS.baseFile },
        journalRef: b1.B1_PATCH_APPLICATION.journalRef,
      }),
    );
    expect(result.state).toBe("applied");
    expect(result.writeCount).toBe(1);
    expect(result.outputArtifactVersions).toBe(1);
    expect(result.writebackToSource).toBe(false);
    expect(result.journalRef).toBe(b1.B1_PATCH_APPLICATION.journalRef);
  });

  it("reports conflicts without merging, writing back, or minting an artifact", async () => {
    const { patches, b1 } = await subject();
    const proposal = expectOk(
      patches.propose({ ...b1.B1_PATCH_PROPOSAL, patchDigest: undefined, state: undefined }),
    );
    const result = expectOk(
      patches.apply({
        proposal,
        independentGrantId: b1.B1_PATCH_APPLICATION.independentGrantId,
        currentFileDigests: b1.B1_PATCH_CONFLICT.currentFileDigests,
      }),
    );
    expect(result.state).toBe("conflict");
    expect(result.writeCount).toBe(0);
    expect(result.outputArtifactVersions).toBe(0);
    expect(result.autoMerge).toBe(false);
    expect(result.writebackToSource).toBe(false);
  });

  it("supports journaled partial application but always requires an independent grant", async () => {
    const { patches, b1 } = await subject();
    const proposal = expectOk(
      patches.propose({
        ...b1.B1_PATCH_PROPOSAL,
        fileChanges: [
          ...b1.B1_PATCH_PROPOSAL.fileChanges,
          { ...b1.B1_PATCH_PROPOSAL.fileChanges[0]!, path: "src/other.ts" },
        ],
        patchDigest: undefined,
        state: undefined,
      }),
    );
    expectError(
      patches.apply({ proposal, independentGrantId: undefined, currentFileDigests: {} }),
      "independent_grant_required",
    );
    const partial = expectOk(
      patches.apply({
        proposal,
        independentGrantId: b1.B1_PATCH_APPLICATION.independentGrantId,
        currentFileDigests: {
          "src/example.ts": b1.B1_DIGESTS.baseFile,
          "src/other.ts": b1.B1_DIGESTS.concurrentFile,
        },
      }),
    );
    expect(partial.state).toBe("partially_applied");
    expect(partial.writeCount).toBe(1);
    expect(partial.outputArtifactVersions).toBe(1);
  });
});
