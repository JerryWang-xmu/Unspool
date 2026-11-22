import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type BackupManifest,
  backupManifestDigest,
} from "../../../../packages/domain/src/backup-manifest.js";
import { CURRENT_SCHEMA_VERSION } from "../../../../packages/persistence/src/migrations.js";

type BackupObjectEntry = {
  objectId?: string | undefined;
  relativePath: string;
  sha256: string;
  size: number;
};
type BackupSessionEntry = {
  conversationId?: string | undefined;
  relativePath: string;
  sha256: string;
  size: number;
};

type BackupManifestWithEntries = BackupManifest & {
  objectEntries: BackupObjectEntry[];
  sessionEntries: BackupSessionEntry[];
};

export interface RestoreColdBackupInput {
  readonly backupDir: string;
  readonly dataDir: string;
  readonly now?: string | (() => Date);
}

export interface RestoreColdBackupResult {
  readonly ok: boolean;
  readonly manifest?: BackupManifest;
  readonly error?: { code: string; detail?: string };
  readonly missingObjects: string[];
  readonly digestMismatches: { objectId: string; expectedSha256: string; actualSha256: string }[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function emptyDirectory(path: string): Promise<boolean> {
  if (!(await exists(path))) return true;
  return (await readdir(path)).length === 0;
}

async function digestFile(path: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

export async function restoreColdBackup(
  input: RestoreColdBackupInput,
): Promise<RestoreColdBackupResult> {
  const manifestPath = join(input.backupDir, "manifest.json");
  if (!(await exists(manifestPath))) {
    return {
      ok: false,
      error: { code: "backup_invalid" },
      missingObjects: ["manifest.json"],
      digestMismatches: [],
    };
  }
  let manifest: BackupManifestWithEntries;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifestWithEntries;
    if (!Array.isArray(manifest.objectEntries) || !Array.isArray(manifest.sessionEntries))
      throw new TypeError("Invalid backup entries");
  } catch {
    return {
      ok: false,
      error: { code: "backup_invalid" },
      missingObjects: [],
      digestMismatches: [],
    };
  }
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: "backup_invalid",
        detail: "Backup schema is newer than this Runner supports.",
      },
      missingObjects: [],
      digestMismatches: [],
    };
  }
  const { digest, ...withoutDigest } = manifest;
  if (digest !== backupManifestDigest(withoutDigest)) {
    return {
      ok: false,
      error: { code: "backup_invalid" },
      missingObjects: [],
      digestMismatches: [
        {
          objectId: manifest.id,
          expectedSha256: digest,
          actualSha256: backupManifestDigest(withoutDigest),
        },
      ],
    };
  }

  const missingObjects: string[] = [];
  const digestMismatches: { objectId: string; expectedSha256: string; actualSha256: string }[] = [];
  const databasePath = join(input.backupDir, "unspool.sqlite");
  const databaseEntry = manifest.databaseEntry as
    | { relativePath?: string; sha256?: string; size?: number }
    | undefined;
  if (
    databaseEntry?.relativePath !== "unspool.sqlite" ||
    typeof databaseEntry.sha256 !== "string" ||
    typeof databaseEntry.size !== "number"
  ) {
    return {
      ok: false,
      error: { code: "backup_invalid", detail: "Database entry is missing or malformed." },
      missingObjects: [],
      digestMismatches: [],
    };
  }
  if (
    !(await exists(databasePath)) ||
    !(await lstat(databasePath)).isFile() ||
    (await lstat(databasePath)).isSymbolicLink()
  ) {
    missingObjects.push("unspool.sqlite");
  } else {
    const actualDigest = await digestFile(databasePath);
    const actualSize = (await stat(databasePath)).size;
    if (actualDigest !== databaseEntry.sha256 || actualSize !== databaseEntry.size) {
      digestMismatches.push({
        objectId: "unspool.sqlite",
        expectedSha256: databaseEntry.sha256,
        actualSha256: actualDigest,
      });
    }
  }
  for (const entry of [...manifest.objectEntries, ...manifest.sessionEntries]) {
    const path = resolve(input.backupDir, entry.relativePath);
    if (!path.startsWith(`${resolve(input.backupDir)}${sep}`)) {
      missingObjects.push(typeof entry.objectId === "string" ? entry.objectId : entry.relativePath);
      continue;
    }
    if (!(await exists(path))) {
      missingObjects.push(typeof entry.objectId === "string" ? entry.objectId : entry.relativePath);
      continue;
    }
    const details = await lstat(path);
    const realBackupRoot = await realpath(input.backupDir);
    const realEntry = await realpath(path);
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      !realEntry.startsWith(`${realBackupRoot}${sep}`)
    ) {
      missingObjects.push(typeof entry.objectId === "string" ? entry.objectId : entry.relativePath);
      continue;
    }
    const actualDigest = await digestFile(path);
    if (actualDigest !== entry.sha256 || details.size !== entry.size) {
      digestMismatches.push({
        objectId: typeof entry.objectId === "string" ? entry.objectId : entry.relativePath,
        expectedSha256: entry.sha256,
        actualSha256: actualDigest,
      });
    }
  }
  if (missingObjects.length > 0 || digestMismatches.length > 0) {
    return { ok: false, error: { code: "backup_invalid" }, missingObjects, digestMismatches };
  }
  if (!(await emptyDirectory(input.dataDir))) {
    return {
      ok: false,
      error: { code: "target_not_empty" },
      missingObjects: [],
      digestMismatches: [],
    };
  }

  const staging = join(`${input.dataDir}.restore-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    await cp(join(input.backupDir, "unspool.sqlite"), join(staging, "unspool.sqlite"));
    for (const entry of [...manifest.objectEntries, ...manifest.sessionEntries]) {
      const source = resolve(input.backupDir, entry.relativePath);
      const destination = resolve(staging, entry.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination);
    }
    await cp(manifestPath, join(staging, "manifest.json"));
    const restored = new DatabaseSync(join(staging, "unspool.sqlite"));
    const integrity = restored.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    restored.close();
    if (integrity.integrity_check !== "ok")
      throw new Error("Restored SQLite integrity check failed");
    if (await exists(input.dataDir)) await rm(input.dataDir, { recursive: true });
    await rename(staging, input.dataDir);
    return { ok: true, manifest, missingObjects: [], digestMismatches: [] };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    return {
      ok: false,
      error: {
        code: "backup_invalid",
        detail: error instanceof Error ? error.message : String(error),
      },
      missingObjects: [],
      digestMismatches: [],
    };
  }
}
