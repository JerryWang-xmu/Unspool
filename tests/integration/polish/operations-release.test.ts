import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createColdBackup } from "../../../apps/runner-api/src/maintenance/backup.js";
import { restoreColdBackup } from "../../../apps/runner-api/src/maintenance/restore.js";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service.js";
import { assertValidationCatalogComplete } from "../../../apps/runner-api/src/statistics/release-evidence.js";
import { uuidv7 } from "../../../packages/security/src/uuid.js";

describe("Polish operations and release evidence", () => {
  it("backs up and restores a real empty-host data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-polish-source-"));
    const backupParent = await mkdtemp(join(tmpdir(), "unspool-polish-backup-"));
    const restored = await mkdtemp(join(tmpdir(), "unspool-polish-restored-"));
    try {
      const opened = await openPersonalService({ dataDir });
      const owner = uuidv7();
      const created = await opened.service.createTask(
        owner,
        {
          name: "Operations",
          goal: "Backup",
          completionCriteria: "Restore",
          runnerId: uuidv7(),
          agentProfileId: uuidv7(),
          payloadDigest: `sha256:${"a".repeat(64)}`,
        },
        uuidv7(),
      );
      await opened.close();
      const backupDir = join(backupParent, "cold");
      await createColdBackup({
        dataDir,
        backupDir,
        appVersion: "0.1.0",
        now: "2026-11-22T00:00:00.000Z",
      });
      expect((await restoreColdBackup({ backupDir, dataDir: restored })).ok).toBe(true);
      const reopened = await openPersonalService({ dataDir: restored });
      expect(
        (await reopened.service.listTasks(owner)).personalTasks.map((task) => task.id),
      ).toContain(created.response.workspace.id);
      await reopened.close();
    } finally {
      await Promise.all(
        [dataDir, backupParent, restored].map((path) => rm(path, { recursive: true, force: true })),
      );
    }
  });

  it("keeps the per-ID validation catalog complete and stage-gated", () => {
    expect(() => assertValidationCatalogComplete()).not.toThrow();
  });
});
