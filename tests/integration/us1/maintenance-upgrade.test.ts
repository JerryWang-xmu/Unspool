import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createColdBackup } from "../../../apps/runner-api/src/maintenance/backup.js";
import { restoreColdBackup } from "../../../apps/runner-api/src/maintenance/restore.js";
import { openPersonalRepository } from "../../../apps/runner-api/src/personal/repository.js";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service.js";
import { openDatabase } from "../../../packages/persistence/src/database.js";
import { uuidv7 } from "../../../packages/security/src/uuid.js";

const directories: string[] = [];
async function temp(label: string) {
  const directory = await mkdtemp(join(tmpdir(), `unspool-us1-${label}-`));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("US1 maintenance schema gates", () => {
  it("backs up and restores a valid personal database with no object or session directories", async () => {
    const dataDir = await temp("empty-objects");
    const owner = uuidv7();
    const opened = await openPersonalService({ dataDir });
    const created = await opened.service.createTask(
      owner,
      {
        name: "No objects",
        goal: "Back up",
        completionCriteria: "Restore",
        runnerId: uuidv7(),
        agentProfileId: uuidv7(),
        payloadDigest: `sha256:${"2".repeat(64)}`,
      },
      uuidv7(),
    );
    await opened.close();
    const parent = await temp("empty-objects-backup");
    const backupDir = join(parent, "backup");
    await createColdBackup({
      dataDir,
      backupDir,
      appVersion: "0.1.0",
      now: "2026-11-22T10:00:00.000Z",
    });
    const restoredDir = await temp("empty-objects-restored");
    expect((await restoreColdBackup({ backupDir, dataDir: restoredDir })).ok).toBe(true);
    const repository = await openPersonalRepository({ dataDir: restoredDir });
    try {
      expect((await repository.listRecentTasks()).map((task) => task.workspaceId)).toContain(
        created.response.workspace.id,
      );
    } finally {
      await repository.close();
    }
  });

  it("refuses to back up a database from a newer schema", async () => {
    const dataDir = await temp("newer-schema");
    const opened = await openPersonalService({ dataDir });
    await opened.close();
    const database = await openDatabase({ filename: join(dataDir, "unspool.sqlite") });
    await database.execute(
      "INSERT INTO schema_migration (version, checksum, applied_at) VALUES (999, ?, ?)",
      [`sha256:${"3".repeat(64)}`, new Date().toISOString()],
    );
    await database.close();
    const parent = await temp("newer-schema-backup");
    await expect(
      createColdBackup({ dataDir, backupDir: join(parent, "backup"), appVersion: "0.1.0" }),
    ).rejects.toMatchObject({ code: "unsupported_schema_version" });
  });
});
