import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createColdBackup } from "../../../apps/runner-api/src/maintenance/backup.js";
import { restoreColdBackup } from "../../../apps/runner-api/src/maintenance/restore.js";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service.js";
import { uuidv7 } from "../../../packages/security/src/uuid.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("cold-backup database integrity", () => {
  it("authenticates the primary SQLite bytes and rejects a tampered database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-backup-db-source-"));
    const parent = await mkdtemp(join(tmpdir(), "unspool-backup-db-parent-"));
    const restoredDir = await mkdtemp(join(tmpdir(), "unspool-backup-db-restored-"));
    directories.push(dataDir, parent, restoredDir);
    const opened = await openPersonalService({ dataDir });
    const owner = uuidv7();
    await opened.service.createTask(
      owner,
      {
        name: "Database integrity",
        goal: "Authenticate backup",
        completionCriteria: "Reject tampering",
        runnerId: uuidv7(),
        agentProfileId: uuidv7(),
        payloadDigest: `sha256:${"a".repeat(64)}`,
      },
      uuidv7(),
    );
    await opened.close();
    const backupDir = join(parent, "backup");
    const backup = await createColdBackup({
      dataDir,
      backupDir,
      appVersion: "0.1.0",
      now: "2026-11-22T00:00:00.000Z",
    });
    expect(backup.manifest.databaseEntry).toBeDefined();
    const original = await readFile(join(backupDir, "unspool.sqlite"));
    await writeFile(
      join(backupDir, "unspool.sqlite"),
      Buffer.concat([original, Buffer.from("tampered")]),
    );
    const result = await restoreColdBackup({ backupDir, dataDir: restoredDir });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("backup_invalid");
    expect(result.digestMismatches.some((entry) => entry.objectId === "unspool.sqlite")).toBe(true);
  });
});
