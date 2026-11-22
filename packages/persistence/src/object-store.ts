import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

const DIGEST_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/i;

export interface ObjectStoreOptions {
  readonly directory: string;
}

export interface PutObjectOptions {
  readonly mediaType?: string;
}

export interface StoredObject {
  readonly sha256: string;
  readonly storageKey: string;
  readonly size: number;
  readonly mediaType?: string;
}

export interface ObjectManifestEntry {
  readonly sha256: string;
  readonly storageKey: string;
  readonly size: number;
}

export interface ObjectManifest {
  readonly algorithm: "sha256";
  readonly objects: ObjectManifestEntry[];
  readonly digest: string;
}

export interface ReconcileOptions {
  readonly removeOrphans?: boolean;
}

export interface ReconcileResult {
  readonly missing: string[];
  readonly orphaned: string[];
  readonly removed: string[];
}

export interface ObjectStore {
  readonly directory: string;
  put(data: string | Uint8Array, options?: PutObjectOptions): Promise<StoredObject>;
  get(sha256: string): Promise<Uint8Array>;
  has(sha256: string): Promise<boolean>;
  stat(sha256: string): Promise<StoredObject | undefined>;
  manifest(): Promise<ObjectManifest>;
  reconcile(referenced: Iterable<string>, options?: ReconcileOptions): Promise<ReconcileResult>;
}

export class ObjectNotFoundError extends Error {
  readonly code = "object_not_found";
  readonly sha256: string;

  constructor(sha256: string) {
    super(`Stored object not found: ${sha256}`);
    this.name = "ObjectNotFoundError";
    this.sha256 = sha256;
  }
}

export class ObjectIntegrityError extends Error {
  readonly code = "object_integrity_error";
  readonly sha256: string;
  readonly actualSha256: string;

  constructor(sha256: string, actualSha256: string) {
    super(`Stored object ${sha256} has content digest ${actualSha256}.`);
    this.name = "ObjectIntegrityError";
    this.sha256 = sha256;
    this.actualSha256 = actualSha256;
  }
}

export function objectDigest(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function normalizeDigest(value: string): string {
  const match = DIGEST_PATTERN.exec(value.trim());
  if (!match?.[1]) {
    throw new TypeError(`Object digest must be sha256:<64 hex>: ${value}`);
  }
  return `sha256:${match[1].toLowerCase()}`;
}

function digestHex(sha256: string): string {
  return normalizeDigest(sha256).slice("sha256:".length);
}

export function objectStorageKey(sha256: string): string {
  const hex = digestHex(sha256);
  return `objects/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}.blob`;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EISDIR" && code !== "EPERM" && code !== "EACCES" && code !== "EBADF") {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function collectObjectFiles(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectObjectFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".blob")) {
      files.push(path);
    }
  }
  return files.sort();
}

class ContentAddressedObjectStore implements ObjectStore {
  readonly directory: string;

  constructor(options: ObjectStoreOptions | string) {
    this.directory = typeof options === "string" ? options : options.directory;
  }

  async put(data: string | Uint8Array, options: PutObjectOptions = {}): Promise<StoredObject> {
    const bytes = toBytes(data);
    const sha256 = objectDigest(bytes);
    const storageKey = objectStorageKey(sha256);
    const finalPath = this.#pathFor(sha256);
    const stagingDirectory = join(this.directory, ".staging");
    await mkdir(stagingDirectory, { recursive: true });
    await mkdir(dirname(finalPath), { recursive: true });

    const stagingPath = join(stagingDirectory, `${randomUUID()}.tmp`);
    const handle = await open(stagingPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      try {
        await access(finalPath);
      } catch {
        await rename(stagingPath, finalPath);
        await fsyncDirectory(dirname(finalPath));
      }
    } finally {
      await rm(stagingPath, { force: true });
    }

    const stored: StoredObject = {
      sha256,
      storageKey,
      size: bytes.byteLength,
      ...(options.mediaType === undefined ? {} : { mediaType: options.mediaType }),
    };
    return stored;
  }

  async get(sha256: string): Promise<Uint8Array> {
    const normalized = normalizeDigest(sha256);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.#pathFor(normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ObjectNotFoundError(normalized);
      }
      throw error;
    }

    const actual = objectDigest(bytes);
    if (actual !== normalized) {
      throw new ObjectIntegrityError(normalized, actual);
    }
    return bytes;
  }

  async has(sha256: string): Promise<boolean> {
    try {
      await access(this.#pathFor(sha256));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async stat(sha256: string): Promise<StoredObject | undefined> {
    const normalized = normalizeDigest(sha256);
    try {
      const details = await stat(this.#pathFor(normalized));
      if (!details.isFile()) return undefined;
      return {
        sha256: normalized,
        storageKey: objectStorageKey(normalized),
        size: details.size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async manifest(): Promise<ObjectManifest> {
    const objects: ObjectManifestEntry[] = [];
    for (const path of await collectObjectFiles(join(this.directory, "objects"))) {
      const bytes = await readFile(path);
      const sha256 = objectDigest(bytes);
      const storageKey = relative(this.directory, path).split(sep).join("/");
      const expectedKey = objectStorageKey(sha256);
      if (storageKey !== expectedKey) {
        const fileName = basename(path);
        const expectedDigest = `sha256:${fileName.slice(0, -".blob".length)}`;
        throw new ObjectIntegrityError(expectedDigest, sha256);
      }
      objects.push({ sha256, storageKey, size: bytes.byteLength });
    }

    objects.sort((left, right) => left.sha256.localeCompare(right.sha256));
    const digest = objectDigest(JSON.stringify(objects));
    return { algorithm: "sha256", objects, digest };
  }

  async reconcile(
    referenced: Iterable<string>,
    options: ReconcileOptions = {},
  ): Promise<ReconcileResult> {
    const referencedDigests = new Set([...referenced].map(normalizeDigest));
    const stored = await this.manifest();
    const storedDigests = new Set(stored.objects.map((entry) => entry.sha256));

    const missing = [...referencedDigests].filter((digest) => !storedDigests.has(digest)).sort();
    const orphaned = stored.objects
      .map((entry) => entry.sha256)
      .filter((digest) => !referencedDigests.has(digest))
      .sort();

    const removed: string[] = [];
    if (options.removeOrphans === true) {
      for (const digest of orphaned) {
        const path = this.#pathFor(digest);
        await rm(path, { force: true });
        await fsyncDirectory(dirname(path));
        removed.push(digest);
      }
    }

    return { missing, orphaned, removed };
  }

  #pathFor(sha256: string): string {
    return join(this.directory, ...objectStorageKey(sha256).split("/"));
  }
}

export function createObjectStore(options: ObjectStoreOptions | string): ObjectStore {
  return new ContentAddressedObjectStore(options);
}

export const openObjectStore = createObjectStore;
