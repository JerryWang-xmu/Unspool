import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type BackupManifest,
  backupManifestDigest,
} from "../../../../packages/domain/src/backup-manifest.js";
import {
  CURRENT_SCHEMA_VERSION,
  UnsupportedSchemaError,
} from "../../../../packages/persistence/src/migrations.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";

export interface ColdBackupInput {
  readonly dataDir: string;
  readonly backupDir: string;
  readonly appVersion: string;
  readonly now?: string | (() => Date);
}

export interface ColdBackupResult {
  readonly manifest: BackupManifest;
  readonly manifestPath: string;
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

async function fileEntries(root: string, kind: "object" | "session") {
  const entries: {
    objectId?: string;
    conversationId?: string;
    relativePath: string;
    sha256: string;
    size: number;
  }[] = [];
  if (!(await exists(root))) return entries;
  for (const name of await readdir(root, { recursive: true })) {
    const absolute = join(root, name);
    const info = await stat(absolute);
    if (!info.isFile()) continue;
    const relativePath = `${kind === "object" ? "objects" : "sessions"}/${relative(root, absolute).replaceAll("\\", "/")}`;
    const entry: {
      objectId?: string;
      conversationId?: string;
      relativePath: string;
      sha256: string;
      size: number;
    } = {
      relativePath,
      sha256: await digestFile(absolute),
      size: info.size,
    };
    if (kind === "object") entry.objectId = relativePath.replace(/\.blob$/, "");
    if (kind === "session") {
      const firstLine = (await readFile(absolute, "utf8")).split(/\r?\n/, 1)[0] ?? "{}";
      entry.conversationId = JSON.parse(firstLine).id as string;
    }
    entries.push(entry);
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function createColdBackup(input: ColdBackupInput): Promise<ColdBackupResult> {
  if (!(await emptyDirectory(input.backupDir)) && (await readdir(input.backupDir)).length > 0) {
    throw new Error(`Backup destination ${input.backupDir} is not empty`);
  }
  const now =
    typeof input.now === "function"
      ? input.now().toISOString()
      : (input.now ?? new Date().toISOString());
  const staging = resolve(`${input.backupDir}.staging-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    const databasePath = join(input.dataDir, "unspool.sqlite");
    const source = new DatabaseSync(databasePath);
    source.exec("PRAGMA busy_timeout = 5000");
    source.exec("PRAGMA foreign_keys = ON");
    const versionRow = source
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migration")
      .get() as { version: number } | undefined;
    if ((versionRow?.version ?? 0) > CURRENT_SCHEMA_VERSION) {
      source.close();
      throw new UnsupportedSchemaError(versionRow?.version ?? 0, CURRENT_SCHEMA_VERSION);
    }
    const snapshotPath = join(staging, "unspool.sqlite");
    source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
    source.close();

    if (await exists(join(input.dataDir, "objects"))) {
      await cp(join(input.dataDir, "objects"), join(staging, "objects"), { recursive: true });
    }
    if (await exists(join(input.dataDir, "sessions"))) {
      await cp(join(input.dataDir, "sessions"), join(staging, "sessions"), { recursive: true });
    }

    const workspaceSequences: Record<string, number> = {};
    const snapshot = new DatabaseSync(snapshotPath);
    const rows = snapshot
      .prepare(
        "SELECT workspace_id, MAX(sequence) AS sequence FROM domain_event GROUP BY workspace_id",
      )
      .all() as { workspace_id: string; sequence: number }[];
    for (const row of rows) workspaceSequences[row.workspace_id] = row.sequence;
    const blobIds: Record<string, string> = {};
    for (const row of snapshot.prepare("SELECT id, sha256 FROM blob_object").all() as {
      id: string;
      sha256: string;
    }[]) {
      blobIds[row.sha256] = row.id;
    }
    snapshot.close();

    const objectEntries = await fileEntries(join(staging, "objects"), "object");
    for (const entry of objectEntries) {
      const blobId = blobIds[entry.sha256];
      if (blobId !== undefined) entry.objectId = blobId;
    }
    const sessionEntries = await fileEntries(join(staging, "sessions"), "session");
    const withoutDigest = {
      id: uuidv7(new Date(now).getTime()),
      appVersion: input.appVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastWorkspaceSequences: workspaceSequences,
      objectEntries,
      sessionEntries,
      databaseEntry: {
        relativePath: "unspool.sqlite",
        sha256: await digestFile(snapshotPath),
        size: (await stat(snapshotPath)).size,
      },
      createdAt: now,
    };
    const manifest: BackupManifest = {
      ...withoutDigest,
      digest: backupManifestDigest(withoutDigest),
    };
    const manifestPath = join(staging, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(staging, input.backupDir);
    return { manifest, manifestPath: join(input.backupDir, "manifest.json") };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
