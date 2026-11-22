import { afterEach, describe, expect, it } from "vitest";
import { effectiveFederationLevel } from "../../../apps/runner-api/src/federation/gates.js";
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

describe("US6 receipt recovery and Stable isolation", () => {
  it("backfills gaps idempotently without turning malicious claims into facts", async () => {
    const { fixture, receipts } = await subject();
    expectOk(receipts.append(fixture.receipts.beforeGap));
    expectOk(receipts.append(fixture.receipts.afterGap));
    expect(receipts.gaps(fixture.receipts.gap.nodeId).value).toHaveLength(1);
    expectOk(receipts.append(fixture.receipts.afterGap));
    expect(receipts.list(fixture.receipts.gap.nodeId).value).toHaveLength(2);
    for (const sequence of [1291, 1292, 1293])
      expectOk(
        receipts.backfill({
          ...fixture.receipts.afterGap,
          eventId: `backfill-${sequence}`,
          nodeSequence: sequence,
        }),
      );
    expect(
      receipts.gaps(fixture.receipts.gap.nodeId).value.every((gap) => gap.resolvedAt !== undefined),
    ).toBe(true);
    const malicious = expectOk(
      receipts.reviewMalicious([
        fixture.maliciousNode.forgedSuccess,
        ...fixture.maliciousNode.contradictory,
      ]),
    );
    expect(malicious.verifiedBusinessFact).toBe(false);
    expect(malicious.state).toBe("review_required");
  });

  it("pauses/quarantines locally and never replays an unknown outcome", async () => {
    const { nodes } = await subject();
    expectOk(nodes.apply("node", "quarantined", 1, "malicious contradiction"));
    expect(nodes.canUse("node").value).toBe(false);
    expectError(nodes.unquarantine("node", 2, false), "unquarantine_local_only");
    expectOk(nodes.unquarantine("node", 2, true));
    expect(nodes.canUse("node").value).toBe(true);
    expect(nodes.recover("node", true, false).value).toMatchObject({
      state: "outcome_unknown",
      autoReplay: false,
    });
  });

  it("keeps Stable disabled unless every gate opts in without widening upgrades", async () => {
    expect(effectiveFederationLevel({ globalLevel: "disabled" })).toBe("disabled");
    expect(
      effectiveFederationLevel({ globalLevel: "snapshot_tools_patch", teamLevel: "disabled" }),
    ).toBe("disabled");
    expect(
      effectiveFederationLevel({
        globalLevel: "snapshot",
        teamLevel: "snapshot_tools",
        workspaceLevel: "snapshot_tools_patch",
        nodeLevel: "snapshot",
      }),
    ).toBe("snapshot");
  });
});
