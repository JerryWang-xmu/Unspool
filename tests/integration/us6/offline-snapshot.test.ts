import { afterEach, describe, expect, it } from "vitest";
import {
  readOfflineSnapshot,
  SnapshotService,
} from "../../../apps/runner-api/src/federation/snapshot-service";
import { createFederationHarness } from "../../../packages/test-support/src/federation/harness";

// Offline snapshot evidence uses the production SnapshotService directly.

let harness: Awaited<ReturnType<typeof createFederationHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("authorized offline sealed snapshots", () => {
  it("returns the sealed bytes only for the named recipient and current Grant", async () => {
    harness = await createFederationHarness();
    const { fixture } = harness;
    const snapshots = new SnapshotService({ now: () => new Date(fixture.now) });
    const manifest = await snapshots.create({
      nodeId: "node",
      resourceId: "resource",
      root: fixture.paths.snapshotRoot,
      logicalPaths: ["in/brief.md"],
      pathVisibility: "opaque_only",
      cachePolicy: { centralCache: false, offlineRead: true },
    });
    const entry = manifest.entries[0]!;
    const grant = {
      ...fixture.grants.active,
      nodeId: manifest.nodeId,
      resourceId: manifest.resourceId,
      resourceDigest: manifest.rootDigest,
      rights: { ...fixture.grants.active.rights, cache: true },
      cachePolicy: { centralCache: false, offlineRead: true },
    };
    const verifyGrant = (candidate: typeof grant) =>
      candidate.ownerSignature.startsWith("fixture-owner-signature:");
    const result = readOfflineSnapshot(snapshots, manifest, entry.entryId, {
      grant,
      actorId: grant.recipientRules.recipientIds[0]!,
      now: new Date(fixture.now),
      verifyGrant,
    });
    expect(new TextDecoder().decode(result.bytes)).toContain("fixture");
    expect(() =>
      readOfflineSnapshot(snapshots, manifest, entry.entryId, {
        grant,
        actorId: "another-recipient",
        now: new Date(fixture.now),
        verifyGrant,
      }),
    ).toThrow("offline_read_denied");
    expect(() =>
      readOfflineSnapshot(snapshots, manifest, entry.entryId, {
        grant: { ...grant, expiresAt: fixture.now },
        actorId: grant.recipientRules.recipientIds[0]!,
        now: new Date(fixture.now),
        verifyGrant,
      }),
    ).toThrow("offline_read_denied");
    expect(() =>
      readOfflineSnapshot(snapshots, manifest, entry.entryId, {
        grant: { ...grant, rights: { ...grant.rights, cache: false } },
        actorId: grant.recipientRules.recipientIds[0]!,
        now: new Date(fixture.now),
        verifyGrant,
      }),
    ).toThrow("offline_read_denied");
  });
});
