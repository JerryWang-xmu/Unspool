import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createObjectStore,
  ObjectIntegrityError,
  ObjectNotFoundError,
  type ObjectStore,
  objectDigest,
  objectStorageKey,
} from "../src/object-store.js";

const fsTrace = vi.hoisted(() => ({
  events: [] as Array<
    | { kind: "sync"; path: string }
    | {
        kind: "rename";
        from: string;
        to: string;
        sourceExisted: boolean;
        destinationExisted: boolean;
      }
  >,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (
      path: Parameters<typeof actual.open>[0],
      flags?: Parameters<typeof actual.open>[1],
      mode?: Parameters<typeof actual.open>[2],
    ) => {
      const handle = await actual.open(path, flags, mode);
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        fsTrace.events.push({ kind: "sync", path: String(path) });
        return originalSync();
      };
      return handle;
    },
    rename: async (
      from: Parameters<typeof actual.rename>[0],
      to: Parameters<typeof actual.rename>[1],
    ) => {
      const [sourceExisted, destinationExisted] = await Promise.all([
        actual.access(from).then(
          () => true,
          () => false,
        ),
        actual.access(to).then(
          () => true,
          () => false,
        ),
      ]);
      fsTrace.events.push({
        kind: "rename",
        from: String(from),
        to: String(to),
        sourceExisted,
        destinationExisted,
      });
      return actual.rename(from, to);
    },
  };
});

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<{ directory: string; store: ObjectStore }> {
  const directory = await mkdtemp(join(tmpdir(), "unspool-object-store-"));
  temporaryDirectories.push(directory);
  return { directory, store: createObjectStore({ directory }) };
}

function digestOf(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function blobPath(directory: string, sha256: string): string {
  return join(directory, ...objectStorageKey(sha256).split("/"));
}

async function listBlobFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.name.endsWith(".blob")) {
        files.push(relative(directory, path).split(sep).join("/"));
      }
    }
  }

  await walk(directory);
  return files.sort();
}

beforeEach(() => {
  fsTrace.events.length = 0;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("content-addressed object store", () => {
  it("writes staged bytes to a content-addressed blob and leaves no temporary files", async () => {
    const { directory, store } = await createFixture();
    const payload = Uint8Array.from({ length: 256 }, (_, index) => index);
    const expectedDigest = digestOf(payload);

    expect(objectDigest(payload)).toBe(expectedDigest);
    const stored = await store.put(payload, { mediaType: "application/octet-stream" });

    expect(stored).toEqual({
      sha256: expectedDigest,
      storageKey: objectStorageKey(expectedDigest),
      size: payload.byteLength,
      mediaType: "application/octet-stream",
    });
    expect(stored.storageKey).toMatch(/^objects\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.blob$/);
    expect(new Uint8Array(await readFile(blobPath(directory, expectedDigest)))).toEqual(payload);
    expect((await stat(blobPath(directory, expectedDigest))).size).toBe(payload.byteLength);
    expect(await readdir(join(directory, ".staging"))).toEqual([]);
    expect(await listBlobFiles(directory)).toEqual([stored.storageKey]);
    expect(new Uint8Array(await store.get(expectedDigest))).toEqual(payload);
  });

  it("fsyncs a staging file before atomically renaming it into its content address", async () => {
    const { directory, store } = await createFixture();
    const data = "durable ingestion payload";
    const expectedDigest = digestOf(data);
    const finalPath = blobPath(directory, expectedDigest);

    await store.put(data);

    const renameIndex = fsTrace.events.findIndex(
      (event) => event.kind === "rename" && event.to === finalPath,
    );
    expect(renameIndex).toBeGreaterThanOrEqual(0);
    const rename = fsTrace.events[renameIndex];
    if (rename?.kind !== "rename") throw new Error("expected a rename event");
    expect(rename.sourceExisted).toBe(true);
    expect(rename.destinationExisted).toBe(false);
    expect(dirname(rename.from)).toBe(join(directory, ".staging"));
    expect(basename(rename.from)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/,
    );

    const syncIndex = fsTrace.events.findIndex(
      (event) => event.kind === "sync" && event.path === rename.from,
    );
    expect(syncIndex).toBeGreaterThanOrEqual(0);
    expect(syncIndex).toBeLessThan(renameIndex);

    expect(new TextDecoder().decode(await readFile(finalPath))).toBe(data);
    expect(await readdir(join(directory, ".staging"))).toEqual([]);
  });

  it("reads by digest, normalizes prefixed and bare digests, and reports missing objects", async () => {
    const { store } = await createFixture();
    const data = "read me back";
    const stored = await store.put(data);
    const bytes = await store.get(stored.sha256);

    expect(new TextDecoder().decode(bytes)).toBe(data);
    expect(new TextDecoder().decode(await store.get(stored.sha256.slice("sha256:".length)))).toBe(
      data,
    );
    expect(await store.has(stored.sha256)).toBe(true);
    await expect(store.stat(stored.sha256)).resolves.toEqual({
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      size: stored.size,
    });

    const missing = digestOf("never stored");
    await expect(store.get(missing)).rejects.toMatchObject({
      name: "ObjectNotFoundError",
      code: "object_not_found",
      sha256: missing,
    });
    await expect(store.get(missing)).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(await store.has(missing)).toBe(false);
    await expect(store.stat(missing)).resolves.toBeUndefined();

    await expect(store.get("sha256:not-a-digest")).rejects.toBeInstanceOf(TypeError);
  });

  it("deduplicates identical string and byte content, including concurrent writes", async () => {
    const { directory, store } = await createFixture();
    const text = "identical payload";
    const bytes = new TextEncoder().encode(text);
    const expectedDigest = digestOf(text);

    const fromString = await store.put(text, { mediaType: "text/plain" });
    const fromBytes = await store.put(bytes);
    const [first, second, third] = await Promise.all([
      store.put(text),
      store.put(bytes),
      store.put(new TextEncoder().encode(text)),
    ]);

    expect(
      new Set([fromString.sha256, fromBytes.sha256, first.sha256, second.sha256, third.sha256]),
    ).toEqual(new Set([expectedDigest]));
    expect(
      new Set([
        fromString.storageKey,
        fromBytes.storageKey,
        first.storageKey,
        second.storageKey,
        third.storageKey,
      ]),
    ).toEqual(new Set([objectStorageKey(expectedDigest)]));
    expect(await listBlobFiles(directory)).toEqual([objectStorageKey(expectedDigest)]);
    expect(new TextDecoder().decode(await store.get(expectedDigest))).toBe(text);

    const manifest = await store.manifest();
    expect(manifest.objects).toHaveLength(1);
    expect(manifest.objects[0]?.size).toBe(bytes.byteLength);
  });

  it("produces a deterministic manifest with verified sizes, keys, and digest", async () => {
    const { store } = await createFixture();
    const empty = await store.manifest();
    expect(empty).toEqual({ algorithm: "sha256", objects: [], digest: digestOf("[]") });

    const stored = [];
    for (const payload of ["third", "first", "second"]) {
      stored.push(await store.put(payload));
    }
    const sorted = [...stored].sort((left, right) => left.sha256.localeCompare(right.sha256));
    const manifest = await store.manifest();

    expect(manifest.algorithm).toBe("sha256");
    expect(manifest.objects.map((entry) => entry.sha256)).toEqual(
      sorted.map((entry) => entry.sha256),
    );
    for (const entry of sorted) {
      expect(manifest.objects).toContainEqual({
        sha256: entry.sha256,
        storageKey: entry.storageKey,
        size: entry.size,
      });
    }
    expect(manifest.digest).toBe(digestOf(JSON.stringify(manifest.objects)));
    await expect(store.manifest()).resolves.toEqual(manifest);
  });

  it("reports missing references and defers orphan cleanup until explicitly requested", async () => {
    const { store } = await createFixture();
    const kept = await store.put("referenced object");
    const firstOrphan = await store.put("first orphan");
    const secondOrphan = await store.put("second orphan");
    const missing = digestOf("referenced but absent");
    const referenced = [kept.sha256.slice("sha256:".length), missing];
    const orphanDigests = [firstOrphan.sha256, secondOrphan.sha256].sort();

    const deferred = await store.reconcile(referenced);
    expect(deferred).toEqual({
      missing: [missing],
      orphaned: orphanDigests,
      removed: [],
    });
    expect(await store.has(firstOrphan.sha256)).toBe(true);
    expect(await store.has(secondOrphan.sha256)).toBe(true);
    expect(await store.has(kept.sha256)).toBe(true);

    const cleaned = await store.reconcile(referenced, { removeOrphans: true });
    expect(cleaned).toEqual({
      missing: [missing],
      orphaned: orphanDigests,
      removed: orphanDigests,
    });
    expect(await store.has(firstOrphan.sha256)).toBe(false);
    expect(await store.has(secondOrphan.sha256)).toBe(false);
    expect(await store.has(kept.sha256)).toBe(true);
    await expect(store.get(firstOrphan.sha256)).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect((await store.manifest()).objects.map((entry) => entry.sha256)).toEqual([kept.sha256]);
  });

  it("reports the requested and actual digests when stored content is corrupted", async () => {
    const { directory, store } = await createFixture();
    const stored = await store.put("original content");
    const corrupted = new TextEncoder().encode("tampered content");
    await writeFile(blobPath(directory, stored.sha256), corrupted);

    const error = await store.get(stored.sha256).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ObjectIntegrityError);
    expect(error).toMatchObject({
      name: "ObjectIntegrityError",
      code: "object_integrity_error",
      sha256: stored.sha256,
      actualSha256: digestOf(corrupted),
    });
  });

  it("fails manifest verification when a blob's path does not match its digest", async () => {
    const { directory, store } = await createFixture();
    const stored = await store.put("stored at its digest");
    const impostorDigest = digestOf("different content");
    const impostorPath = blobPath(directory, impostorDigest);
    await mkdir(dirname(impostorPath), { recursive: true });
    await writeFile(impostorPath, await readFile(blobPath(directory, stored.sha256)));

    const error = await store.manifest().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ObjectIntegrityError);
    expect(error).toMatchObject({
      sha256: impostorDigest,
      actualSha256: stored.sha256,
    });
  });

  it("never exposes abandoned staging files as objects", async () => {
    const { directory, store } = await createFixture();
    const stagingDirectory = join(directory, ".staging");
    const abandoned = new Uint8Array([1, 2, 3]);
    await mkdir(stagingDirectory, { recursive: true });
    await writeFile(join(stagingDirectory, "abandoned.tmp"), abandoned);

    expect((await store.manifest()).objects).toEqual([]);
    expect(await store.has(digestOf(abandoned))).toBe(false);

    await store.put("fresh content");
    expect((await store.manifest()).objects).toHaveLength(1);
    expect(await listBlobFiles(directory)).toHaveLength(1);
  });
});
