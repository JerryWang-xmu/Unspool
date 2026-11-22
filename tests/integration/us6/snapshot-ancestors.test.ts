import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotService } from "../../../apps/runner-api/src/federation/snapshot-service.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("snapshot ancestor containment", () => {
  it("rejects an in-root symlinked directory before returning outside bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "unspool-snapshot-root-"));
    const outside = await mkdtemp(join(tmpdir(), "unspool-snapshot-outside-"));
    directories.push(root, outside);
    await writeFile(join(outside, "secret.txt"), "outside-canary");
    const linked = join(root, "linked");
    let created = false;
    try {
      await symlink(outside, linked, process.platform === "win32" ? "dir" : undefined);
      created = true;
    } catch {
      // The fixture is unavailable on hosts that forbid symlink creation.
    }
    if (!created) return;
    const snapshots = new SnapshotService();
    await expect(
      snapshots.create({
        nodeId: "node",
        resourceId: "resource",
        root,
        logicalPaths: ["linked/secret.txt"],
        pathVisibility: "opaque_only",
        cachePolicy: { centralCache: false, offlineRead: false },
      }),
    ).rejects.toThrow(/snapshot_path_denied|snapshot_non_regular_file/);
  });
});
