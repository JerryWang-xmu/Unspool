import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPatchToDirectory,
  readPatchArtifact,
  readPatchJournal,
} from "../../../apps/execution-worker/src/patch-filesystem.js";
import { createPatchProposal } from "../../../apps/runner-api/src/federation/patch.js";
import {
  B1_BASE_FILE_CONTENT,
  B1_CONCURRENT_FILE_CONTENT,
  B1_DIGESTS,
  B1_PATCH_APPLICATION,
  B1_PATCH_PROPOSAL,
  B1_PATCHED_FILE_CONTENT,
} from "../../../packages/test-support/src/federation/tool-fixtures.js";

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

function digestOf(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function roots(): Promise<{ root: string; sourceRoot: string; outputRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "unspool-us6-patch-fs-"));
  temporary.push(root);
  const sourceRoot = join(root, "source");
  const outputRoot = join(root, "output");
  await mkdir(sourceRoot);
  await mkdir(outputRoot);
  return { root, sourceRoot, outputRoot };
}

async function writeSource(sourceRoot: string, path: string, content: string): Promise<void> {
  const target = join(sourceRoot, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      const details = await lstat(absolutePath);
      if (details.isSymbolicLink()) {
        snapshot[relativePath] = "@symlink";
      } else if (details.isDirectory()) {
        snapshot[relativePath] = "@directory";
        await walk(absolutePath, relativePath);
      } else if (details.isFile()) {
        snapshot[relativePath] = digestOf(await readFile(absolutePath));
      } else {
        snapshot[relativePath] = "@other";
      }
    }
  }
  await walk(root, "");
  return snapshot;
}

function proposalFor(
  fileChanges: readonly {
    readonly path: string;
    readonly baseDigest: string;
    readonly replacementContent: string;
    readonly replacementDigest: string;
  }[],
) {
  return createPatchProposal({
    ...B1_PATCH_PROPOSAL,
    fileChanges: fileChanges.map((change) => ({ ...change, changeType: "update" as const })),
  });
}

function withPath(proposal: ReturnType<typeof createPatchProposal>, path: string) {
  const baseChange = proposal.fileChanges[0];
  if (baseChange === undefined) throw new Error("fixture patch change missing");
  return { ...proposal, fileChanges: [{ ...baseChange, path }] };
}

function applyInput(
  proposal: ReturnType<typeof createPatchProposal>,
  sourceRoot: string,
  outputRoot: string,
  currentFileDigests?: Readonly<Record<string, string>>,
) {
  return {
    proposal,
    independentGrantId: B1_PATCH_APPLICATION.independentGrantId,
    sourceRoot,
    outputRoot,
    journalRef: B1_PATCH_APPLICATION.journalRef,
    ...(currentFileDigests === undefined ? {} : { currentFileDigests }),
  };
}

describe("US6 filesystem Patch application", () => {
  it("atomically writes only into the isolated output and journals retrievable evidence", async () => {
    const { sourceRoot, outputRoot } = await roots();
    await writeSource(sourceRoot, "src/example.ts", B1_BASE_FILE_CONTENT);
    const before = await snapshotTree(sourceRoot);
    const proposal = proposalFor(B1_PATCH_PROPOSAL.fileChanges);

    const result = await applyPatchToDirectory(
      applyInput(proposal, sourceRoot, outputRoot, {
        "src/example.ts": B1_DIGESTS.baseFile,
      }),
    );

    expect(result.state).toBe("applied");
    expect(result.writeCount).toBe(1);
    expect(result.outputArtifactVersions).toBe(1);
    expect(result.autoMerge).toBe(false);
    expect(result.writebackToSource).toBe(false);
    expect(result.journalRef).toBe(B1_PATCH_APPLICATION.journalRef);
    expect(result.resultByFile).toEqual([
      {
        path: "src/example.ts",
        outcome: "applied",
        resultDigest: B1_DIGESTS.patchedFile,
      },
    ]);
    expect(result.actualBaseDigests).toEqual({ "src/example.ts": B1_DIGESTS.baseFile });

    const outputBytes = await readFile(join(outputRoot, "src", "example.ts"));
    expect(new TextDecoder().decode(outputBytes)).toBe(B1_PATCHED_FILE_CONTENT);
    expect(digestOf(outputBytes)).toBe(B1_DIGESTS.patchedFile);

    expect(result.outputArtifacts).toHaveLength(1);
    const artifact = result.outputArtifacts[0];
    if (artifact === undefined) throw new Error("expected output Artifact metadata");
    expect(artifact).toMatchObject({
      kind: "patch",
      path: "src/example.ts",
      digest: B1_DIGESTS.patchedFile,
      size: outputBytes.byteLength,
    });
    expect(await readPatchArtifact({ outputRoot, artifact })).toEqual(outputBytes);

    const journal = await readPatchJournal({
      outputRoot,
      journalRef: B1_PATCH_APPLICATION.journalRef,
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      schemaVersion: 1,
      journalRef: B1_PATCH_APPLICATION.journalRef,
      patchId: proposal.id,
      patchDigest: proposal.patchDigest,
      independentGrantId: B1_PATCH_APPLICATION.independentGrantId,
      state: "applied",
      resultByFile: [
        {
          path: "src/example.ts",
          outcome: "applied",
          resultDigest: B1_DIGESTS.patchedFile,
        },
      ],
      actualBaseDigests: { "src/example.ts": B1_DIGESTS.baseFile },
      writebackToSource: false,
      autoMerge: false,
    });
    expect(journal[0]?.outputArtifacts).toMatchObject([
      {
        path: "src/example.ts",
        digest: B1_DIGESTS.patchedFile,
      },
    ]);

    expect(await snapshotTree(sourceRoot)).toEqual(before);
  });

  it("reports an actual-digest conflict without writing source, output, or journal", async () => {
    const { root, sourceRoot, outputRoot } = await roots();
    await writeSource(sourceRoot, "src/example.ts", B1_CONCURRENT_FILE_CONTENT);
    const before = await snapshotTree(sourceRoot);
    const proposal = proposalFor(B1_PATCH_PROPOSAL.fileChanges);

    const result = await applyPatchToDirectory(
      applyInput(proposal, sourceRoot, outputRoot, {
        "src/example.ts": B1_DIGESTS.baseFile,
      }),
    );

    expect(result.state).toBe("conflict");
    expect(result.writeCount).toBe(0);
    expect(result.outputArtifactVersions).toBe(0);
    expect(result.outputArtifacts).toEqual([]);
    expect(result.resultByFile).toEqual([{ path: "src/example.ts", outcome: "conflict" }]);
    expect(result.actualBaseDigests).toEqual({
      "src/example.ts": B1_DIGESTS.concurrentFile,
    });
    expect(await readdir(outputRoot)).toEqual([]);
    expect(
      await readPatchJournal({ outputRoot, journalRef: B1_PATCH_APPLICATION.journalRef }),
    ).toEqual([]);
    expect(await snapshotTree(sourceRoot)).toEqual(before);

    const missingOutputRoot = join(root, "missing-output");
    const missingResult = await applyPatchToDirectory(
      applyInput(proposal, sourceRoot, missingOutputRoot),
    );
    expect(missingResult.state).toBe("conflict");
    expect(missingResult.writeCount).toBe(0);
    await expect(lstat(missingOutputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies non-conflicting files and journals the honest partial result", async () => {
    const { sourceRoot, outputRoot } = await roots();
    await writeSource(sourceRoot, "src/first.ts", B1_BASE_FILE_CONTENT);
    await writeSource(sourceRoot, "src/second.ts", B1_CONCURRENT_FILE_CONTENT);
    const before = await snapshotTree(sourceRoot);
    const proposal = proposalFor([
      {
        path: "src/first.ts",
        baseDigest: B1_DIGESTS.baseFile,
        replacementContent: B1_PATCHED_FILE_CONTENT,
        replacementDigest: B1_DIGESTS.patchedFile,
      },
      {
        path: "src/second.ts",
        baseDigest: B1_DIGESTS.baseFile,
        replacementContent: B1_PATCHED_FILE_CONTENT,
        replacementDigest: B1_DIGESTS.patchedFile,
      },
    ]);

    const result = await applyPatchToDirectory(applyInput(proposal, sourceRoot, outputRoot));

    expect(result.state).toBe("partially_applied");
    expect(result.writeCount).toBe(1);
    expect(result.outputArtifactVersions).toBe(1);
    expect(result.resultByFile.map((entry) => [entry.path, entry.outcome])).toEqual([
      ["src/first.ts", "applied"],
      ["src/second.ts", "conflict"],
    ]);
    expect(new TextDecoder().decode(await readFile(join(outputRoot, "src", "first.ts")))).toBe(
      B1_PATCHED_FILE_CONTENT,
    );
    await expect(readFile(join(outputRoot, "src", "second.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const journal = await readPatchJournal({
      outputRoot,
      journalRef: B1_PATCH_APPLICATION.journalRef,
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      state: "partially_applied",
      resultByFile: [
        {
          path: "src/first.ts",
          outcome: "applied",
          resultDigest: B1_DIGESTS.patchedFile,
        },
        { path: "src/second.ts", outcome: "conflict" },
      ],
      actualBaseDigests: {
        "src/first.ts": B1_DIGESTS.baseFile,
        "src/second.ts": B1_DIGESTS.concurrentFile,
      },
    });
    expect(journal[0]?.outputArtifacts).toMatchObject([
      { path: "src/first.ts", digest: B1_DIGESTS.patchedFile },
    ]);
    expect(await snapshotTree(sourceRoot)).toEqual(before);
  });

  it("rejects absolute, traversal, drive, and backslash paths before writing", async () => {
    const { sourceRoot, outputRoot } = await roots();
    await writeSource(sourceRoot, "src/example.ts", B1_BASE_FILE_CONTENT);
    const proposal = proposalFor(B1_PATCH_PROPOSAL.fileChanges);

    const deniedPaths = [
      "../escape.ts",
      "/tmp/escape.ts",
      "C:\\Windows\\win.ini",
      "C:/Windows/win.ini",
      "C:escape.ts",
      "src\\example.ts",
      "src/../example.ts",
      "src//example.ts",
    ];
    for (const path of deniedPaths) {
      await expect(
        applyPatchToDirectory(applyInput(withPath(proposal, path), sourceRoot, outputRoot)),
      ).rejects.toThrow("patch_path_denied");
    }
    await expect(
      applyPatchToDirectory({
        ...applyInput(proposal, sourceRoot, outputRoot),
        independentGrantId: undefined,
      }),
    ).rejects.toThrow("independent_grant_required");

    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects symlink ancestors, hardlinks, and nonregular source entries without writing", async () => {
    const { root, sourceRoot, outputRoot } = await roots();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeSource(outside, "example.ts", B1_BASE_FILE_CONTENT);
    await symlink(
      outside,
      join(sourceRoot, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const before = await snapshotTree(sourceRoot);
    const proposal = proposalFor(B1_PATCH_PROPOSAL.fileChanges);

    await expect(
      applyPatchToDirectory(
        applyInput(withPath(proposal, "linked/example.ts"), sourceRoot, outputRoot),
      ),
    ).rejects.toThrow("patch_symlink_denied");
    expect(await readdir(outputRoot)).toEqual([]);
    expect(await snapshotTree(sourceRoot)).toEqual(before);
    expect(await readFile(join(outside, "example.ts"), "utf8")).toBe(B1_BASE_FILE_CONTENT);

    await writeSource(sourceRoot, "hardlink.ts", B1_BASE_FILE_CONTENT);
    await link(join(sourceRoot, "hardlink.ts"), join(sourceRoot, "hardlink-copy.ts"));
    await expect(
      applyPatchToDirectory(applyInput(withPath(proposal, "hardlink.ts"), sourceRoot, outputRoot)),
    ).rejects.toThrow("patch_hardlink_denied");

    await mkdir(join(sourceRoot, "folder.ts"));
    await expect(
      applyPatchToDirectory(applyInput(withPath(proposal, "folder.ts"), sourceRoot, outputRoot)),
    ).rejects.toThrow("patch_nonregular_denied");

    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects a symlinked output ancestor before writing through it", async () => {
    const { root, sourceRoot, outputRoot } = await roots();
    await writeSource(sourceRoot, "src/example.ts", B1_BASE_FILE_CONTENT);
    const outsideOutput = join(root, "outside-output");
    await mkdir(outsideOutput);
    await symlink(
      outsideOutput,
      join(outputRoot, "src"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const proposal = proposalFor(B1_PATCH_PROPOSAL.fileChanges);

    await expect(
      applyPatchToDirectory(applyInput(proposal, sourceRoot, outputRoot)),
    ).rejects.toThrow("patch_symlink_denied");

    expect(await readdir(outsideOutput)).toEqual([]);
    expect(await readFile(join(sourceRoot, "src", "example.ts"), "utf8")).toBe(
      B1_BASE_FILE_CONTENT,
    );
  });
});
