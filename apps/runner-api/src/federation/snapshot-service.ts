import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  B0Grant,
  B0PathVisibility,
  B0SnapshotEntry,
  B0SnapshotManifest,
} from "../../../../packages/test-support/src/federation/fixtures.js";

interface SealedEntry {
  readonly manifestEntry: B0SnapshotEntry;
  readonly bytes: Uint8Array;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  let current = root;
  for (const segment of rel.split(sep)) {
    current = resolve(current, segment);
    const details = await lstat(current);
    if (details.isSymbolicLink()) throw new Error("snapshot_non_regular_file");
    if (current !== target && !details.isDirectory()) throw new Error("snapshot_non_regular_file");
  }
}

function safeLogicalPath(root: string, logicalPath: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Snapshot paths containing controls are deliberately denied.
  if (logicalPath.length === 0 || isAbsolute(logicalPath) || /[\u0000\r\n]/.test(logicalPath))
    throw new Error("snapshot_path_denied");
  const normalized = logicalPath.replaceAll("\\", "/");
  if (
    normalized.split("/").some((segment) => segment === ".." || segment === "") ||
    normalized.startsWith("/")
  )
    throw new Error("snapshot_path_denied");
  const rootPath = resolve(root);
  const target = resolve(rootPath, normalized);
  const rel = relative(rootPath, target);
  if (rel.length === 0 || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("snapshot_path_denied");
  return target;
}

export class SnapshotService {
  readonly #sealed = new Map<string, Map<string, SealedEntry>>();
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: { now?: () => Date; newId?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#newId =
      options.newId ??
      (() =>
        `snapshot-${createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 36)}`);
  }

  async create(input: {
    readonly nodeId: string;
    readonly resourceId: string;
    readonly root: string;
    readonly logicalPaths: readonly string[];
    readonly pathVisibility: B0PathVisibility;
    readonly cachePolicy: { centralCache: boolean; offlineRead: boolean };
  }): Promise<B0SnapshotManifest> {
    if (
      input.logicalPaths.length === 0 ||
      new Set(input.logicalPaths).size !== input.logicalPaths.length
    )
      throw new Error("snapshot_selection_required");
    const rootRealPath = await realpath(input.root);
    const rootStats = await lstat(rootRealPath);
    if (!rootStats.isDirectory()) throw new Error("snapshot_root_invalid");
    const manifestId = this.#newId();
    const sealed = new Map<string, SealedEntry>();
    const entries: B0SnapshotEntry[] = [];
    for (const logicalPath of input.logicalPaths) {
      const target = safeLogicalPath(rootRealPath, logicalPath);
      await rejectSymlinkComponents(rootRealPath, target);
      const targetRealPath = await realpath(target);
      if (!isInside(rootRealPath, targetRealPath)) throw new Error("snapshot_path_denied");
      const details = await lstat(targetRealPath);
      if (details.isSymbolicLink() || !details.isFile())
        throw new Error("snapshot_non_regular_file");
      if (details.dev !== rootStats.dev) throw new Error("snapshot_cross_mount_denied");
      if (details.nlink > 1) throw new Error("snapshot_unconfirmed_hardlink_denied");
      const handle = await open(targetRealPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== rootStats.dev || opened.nlink > 1)
          throw new Error("snapshot_non_regular_file");
        const openedRealPath = await realpath(targetRealPath);
        if (!isInside(rootRealPath, openedRealPath)) throw new Error("snapshot_path_denied");
        bytes = await handle.readFile();
        const finalRealPath = await realpath(targetRealPath);
        if (!isInside(rootRealPath, finalRealPath)) throw new Error("snapshot_path_denied");
        const finalDetails = await lstat(finalRealPath);
        if (
          finalDetails.ino !== opened.ino ||
          finalDetails.dev !== opened.dev ||
          finalDetails.nlink > 1
        )
          throw new Error("snapshot_toctou_replacement");
      } finally {
        await handle.close();
      }
      const entry: B0SnapshotEntry = {
        entryId: `entry-${createHash("sha256").update(logicalPath).digest("hex").slice(0, 16)}`,
        ...(input.pathVisibility === "authorized_recipients" ? { logicalPath } : {}),
        type: "regular_file",
        size: bytes.byteLength,
        contentDigest: digest(bytes),
      };
      entries.push(entry);
      sealed.set(entry.entryId, { manifestEntry: entry, bytes });
    }
    const rootDigest = digest(
      new TextEncoder().encode(
        JSON.stringify(
          entries.map((entry) => ({
            entryId: entry.entryId,
            contentDigest: entry.contentDigest,
            size: entry.size,
          })),
        ),
      ),
    );
    const manifest: B0SnapshotManifest = {
      id: manifestId,
      nodeId: input.nodeId,
      resourceId: input.resourceId,
      rootDigest,
      entries: entries.sort((left, right) => left.entryId.localeCompare(right.entryId)),
      createdAt: this.#now().toISOString(),
      pathVisibility: input.pathVisibility,
      cachePolicy: input.cachePolicy,
      state: "sealed",
    };
    this.#sealed.set(manifestId, sealed);
    return manifest;
  }

  readEntry(
    manifest: B0SnapshotManifest,
    entryId: string,
  ): { bytes: Uint8Array; entry: B0SnapshotEntry } {
    const entry = this.#sealed.get(manifest.id)?.get(entryId);
    if (entry === undefined) throw new Error("snapshot_entry_not_found");
    return { bytes: new Uint8Array(entry.bytes), entry: entry.manifestEntry };
  }

  readOffline(
    manifest: B0SnapshotManifest,
    entryId: string,
  ): { bytes: Uint8Array; entry: B0SnapshotEntry } {
    if (!manifest.cachePolicy.offlineRead) throw new Error("offline_read_denied");
    return this.readEntry(manifest, entryId);
  }

  readCentral(
    manifest: B0SnapshotManifest,
    entryId: string,
  ): { bytes: Uint8Array; entry: B0SnapshotEntry } {
    if (!manifest.cachePolicy.centralCache) throw new Error("central_cache_denied");
    return this.readEntry(manifest, entryId);
  }
}

export function readOfflineSnapshot(
  snapshots: SnapshotService,
  manifest: B0SnapshotManifest,
  entryId: string,
  input: { grant: B0Grant; actorId: string; now: Date; verifyGrant: (grant: B0Grant) => boolean },
): { bytes: Uint8Array; entry: B0SnapshotEntry } {
  const { grant, actorId, now } = input;
  const nowMs = now.getTime();
  if (grant.state !== "active" || !input.verifyGrant(grant)) throw new Error("offline_read_denied");
  if (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
    throw new Error("offline_read_denied");
  if (
    grant.nodeId !== manifest.nodeId ||
    grant.resourceId !== manifest.resourceId ||
    grant.resourceDigest !== manifest.rootDigest
  )
    throw new Error("offline_read_denied");
  if (
    !grant.operations.includes("snapshot.read") ||
    grant.rights.cache !== true ||
    grant.cachePolicy.offlineRead !== true
  )
    throw new Error("offline_read_denied");
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(Date.parse(grant.notBefore)) ||
    !Number.isFinite(Date.parse(grant.expiresAt))
  )
    throw new Error("grant_time_invalid");
  if (Date.parse(grant.notBefore) > nowMs || Date.parse(grant.expiresAt) <= nowMs)
    throw new Error("offline_read_denied");
  return snapshots.readOffline(manifest, entryId);
}
