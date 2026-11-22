import { afterEach, describe, expect, it } from "vitest";
import { createFederationHarness } from "../../../packages/test-support/src/federation/harness.js";
import { expectOk } from "../../support/federation.js";

let harness: Awaited<ReturnType<typeof createFederationHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});
async function subject() {
  harness ??= await createFederationHarness();
  return harness;
}

describe("US6 federated archive aggregation", () => {
  it("exports node, snapshot, Grant, execution and propagation history for offline reading", async () => {
    const { archives, fixture, b1 } = await subject();
    const manifest = expectOk(
      archives.export(
        {
          formatVersion: 1,
          conclusions: [],
          artifacts: [],
          missingItems: ["missing"],
          unknownItems: ["unknown"],
        },
        {
          nodes: [
            { id: "node-a", state: "revoked" },
            { id: "node-b", state: "unavailable" },
          ],
          snapshots: [fixture.snapshot.manifest],
          grants: Object.values(fixture.grants),
          operations: [{ id: "operation-1", state: "invalid" }],
          propagationChains: [b1.B1_CROSS_DOMAIN_TRANSFER],
        },
      ),
    );
    const offline = expectOk(archives.readOffline(manifest));
    expect(offline.federation.nodes.map((node: any) => node.state)).toContain("revoked");
    expect(offline.federation.nodes.map((node: any) => node.state)).toContain("unavailable");
    expect(offline.federation.snapshots).toHaveLength(1);
    expect(offline.federation.grants.length).toBeGreaterThan(0);
    expect(offline.federation.executionVersions[0].state).toBe("invalid");
    expect(offline.federation.propagationChains[0].state).toBe("approved");
    expect(offline.missingItems).toEqual(["missing"]);
    expect(offline.unknownItems).toEqual(["unknown"]);
  });
});
