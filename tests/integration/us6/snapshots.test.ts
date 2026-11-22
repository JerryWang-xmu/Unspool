import { readFile, writeFile } from "node:fs/promises";
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

describe("US6 sealed snapshots", () => {
  it("uses explicit inclusion and independent pathVisibility with fixed versions", async () => {
    const { snapshots } = await subject();
    const opaque = expectOk(await snapshots.create({ pathVisibility: "opaque_only" }));
    expect(opaque.entries.length).toBeGreaterThan(0);
    expect(opaque.entries.every((entry) => entry.logicalPath === undefined)).toBe(true);
    const authorized = expectOk(
      await snapshots.create({ pathVisibility: "authorized_recipients" }),
    );
    expect(authorized.entries.every((entry) => typeof entry.logicalPath === "string")).toBe(true);
    const first = expectOk(snapshots.read(opaque, opaque.entries[0]!.entryId));
    const second = expectOk(snapshots.read(opaque, opaque.entries[0]!.entryId));
    expect(first.entry.contentDigest).toBe(second.entry.contentDigest);
    expectError(snapshots.readOffline(opaque, opaque.entries[0]!.entryId), "offline_read_denied");
  });

  it("rejects traversal and symlinks before opening a canary", async () => {
    const { fixture, snapshots } = await subject();
    for (const logicalPath of [
      "/etc/passwd",
      "../outside/secret-canary.txt",
      "in/../../outside/secret-canary.txt",
      "..\\outside\\secret-canary.txt",
    ]) {
      expectError(await snapshots.create({ logicalPaths: [logicalPath] }), "snapshot_path_denied");
    }
    if (fixture.symlink.created)
      expectError(
        await snapshots.create({ logicalPaths: ["links/outside-canary"] }),
        "snapshot_non_regular_file",
      );
  });

  it("reads the sealed copy after the live file is replaced", async () => {
    const { fixture, snapshots } = await subject();
    const manifest = expectOk(await snapshots.create({ logicalPaths: ["in/brief.md"] }));
    const entry = manifest.entries[0]!;
    const before = expectOk(snapshots.read(manifest, entry.entryId));
    const original = new TextDecoder().decode(before.bytes);
    const replacement = await readFile(fixture.paths.toctouReplacement, "utf8");
    await writeFile(fixture.paths.toctouTarget, replacement, { flag: "w" });
    const after = expectOk(snapshots.read(manifest, entry.entryId));
    expect(new TextDecoder().decode(after.bytes)).toBe(original);
    expect(new TextDecoder().decode(after.bytes)).not.toBe(replacement);
  });
});
