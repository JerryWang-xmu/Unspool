import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve, sep, win32 } from "node:path";
import type {
  B1Digest,
  B1PatchFileResult,
  B1PatchProposal,
} from "../../../packages/test-support/src/federation/tool-fixtures.js";

const JOURNAL_DIRECTORY = ".unspool-journal";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Paths with controls are deliberately denied.
const PATH_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export type PatchFilesystemState = "applied" | "partially_applied" | "conflict";

export type PatchFilesystemFileResult = B1PatchFileResult;

export interface PatchOutputArtifact {
  readonly artifactId: string;
  readonly kind: "patch";
  readonly path: string;
  readonly digest: B1Digest;
  readonly size: number;
  readonly mediaType: "text/plain";
}

export interface PatchJournalEntry {
  readonly schemaVersion: 1;
  readonly journalRef: string;
  readonly patchId: string;
  readonly patchDigest: B1Digest;
  readonly independentGrantId: string;
  readonly state: "applied" | "partially_applied";
  readonly resultByFile: readonly PatchFilesystemFileResult[];
  readonly actualBaseDigests: Readonly<Record<string, B1Digest | null>>;
  readonly outputArtifacts: readonly PatchOutputArtifact[];
  readonly writebackToSource: false;
  readonly autoMerge: false;
  readonly recordedAt: string;
}

export interface PatchFilesystemResult {
  readonly state: PatchFilesystemState;
  readonly resultByFile: readonly PatchFilesystemFileResult[];
  readonly actualBaseDigests: Readonly<Record<string, B1Digest | null>>;
  readonly journalRef: string;
  readonly writeCount: number;
  readonly outputArtifactVersions: number;
  readonly outputArtifacts: readonly PatchOutputArtifact[];
  readonly autoMerge: false;
  readonly writebackToSource: false;
}

export interface ApplyPatchToDirectoryInput {
  readonly proposal: B1PatchProposal;
  readonly independentGrantId: string | undefined;
  readonly sourceRoot: string;
  readonly outputRoot: string;
  readonly currentFileDigests?: Readonly<Record<string, string>>;
  readonly journalRef: string;
}

export interface ReadPatchJournalInput {
  readonly outputRoot: string;
  readonly journalRef: string;
}

export interface ReadPatchArtifactInput {
  readonly outputRoot: string;
  readonly artifact: PatchOutputArtifact;
}

interface PlannedChange {
  readonly change: B1PatchProposal["fileChanges"][number];
  readonly segments: readonly string[];
  readonly actualBaseDigest: B1Digest | null;
  readonly conflict: boolean;
}

function fail(code: string): never {
  throw new Error(code);
}

function digestOf(value: string | Uint8Array): B1Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isDigest(value: unknown): value is B1Digest {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function assertNonEmpty(value: string | undefined, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function safeSegments(path: string): readonly string[] {
  if (path.length === 0 || path.includes("\\") || PATH_CONTROL_PATTERN.test(path)) {
    fail("patch_path_denied");
  }
  if (path.startsWith("/") || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    fail("patch_path_denied");
  }
  // Colons can address NTFS alternate data streams or drive-relative paths.
  if (path.includes(":")) fail("patch_path_denied");

  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("patch_path_denied");
  }
  if (posix.normalize(path) !== path) fail("patch_path_denied");
  if (segments[0] === JOURNAL_DIRECTORY) fail("patch_path_denied");
  return segments;
}

function isWithin(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return (
    childRelative === "" ||
    (childRelative !== ".." &&
      !childRelative.startsWith(`..${sep}`) &&
      !win32.isAbsolute(childRelative))
  );
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolveSourceRoot(sourceRoot: string): Promise<string> {
  assertNonEmpty(sourceRoot, "patch_source_root_required");
  const absolute = resolve(sourceRoot);
  const details = await lstatOrUndefined(absolute);
  if (details === undefined) fail("patch_source_root_not_found");
  if (details.isSymbolicLink()) fail("patch_symlink_denied");
  if (!details.isDirectory()) fail("patch_source_root_not_directory");
  return realpath(absolute);
}

async function resolveOutputRoot(outputRoot: string): Promise<string> {
  assertNonEmpty(outputRoot, "patch_output_root_required");
  const absolute = resolve(outputRoot);
  const details = await lstatOrUndefined(absolute);
  if (details !== undefined) {
    if (details.isSymbolicLink()) fail("patch_symlink_denied");
    if (!details.isDirectory()) fail("patch_output_root_not_directory");
    return realpath(absolute);
  }

  const missing: string[] = [];
  let cursor = absolute;
  while (true) {
    const parent = dirname(cursor);
    if (parent === cursor) fail("patch_output_root_not_found");
    missing.unshift(basename(cursor));
    cursor = parent;
    const existing = await lstatOrUndefined(cursor);
    if (existing === undefined) continue;
    if (existing.isSymbolicLink()) fail("patch_symlink_denied");
    if (!existing.isDirectory()) fail("patch_output_root_not_directory");
    return join(await realpath(cursor), ...missing);
  }
}

async function readSourceFile(
  sourceRoot: string,
  segments: readonly string[],
): Promise<{ readonly digest: B1Digest; readonly bytes: Uint8Array } | null> {
  let cursor = sourceRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    const details = await lstatOrUndefined(cursor);
    if (details === undefined) return null;
    if (details.isSymbolicLink()) fail("patch_symlink_denied");
    if (index < segments.length - 1) {
      if (!details.isDirectory()) fail("patch_nonregular_denied");
      continue;
    }
    if (!details.isFile()) fail("patch_nonregular_denied");
    if (details.nlink > 1) fail("patch_hardlink_denied");
    const bytes = await readFile(cursor);
    return { digest: digestOf(bytes), bytes };
  }
  return null;
}

async function assertOutputPathUsable(
  outputRoot: string,
  segments: readonly string[],
): Promise<void> {
  let cursor = outputRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    const details = await lstatOrUndefined(cursor);
    if (details === undefined) return;
    if (details.isSymbolicLink()) fail("patch_symlink_denied");
    if (index < segments.length - 1) {
      if (!details.isDirectory()) fail("patch_output_parent_denied");
      continue;
    }
    if (!details.isFile()) fail("patch_output_nonregular_denied");
    if (details.nlink > 1) fail("patch_output_hardlink_denied");
  }
}

function journalFileName(journalRef: string): string {
  return `${createHash("sha256").update(journalRef).digest("hex")}.jsonl`;
}

function journalPath(outputRoot: string, journalRef: string): string {
  return join(outputRoot, JOURNAL_DIRECTORY, journalFileName(journalRef));
}

async function assertJournalPathUsable(outputRoot: string): Promise<void> {
  const directory = join(outputRoot, JOURNAL_DIRECTORY);
  const details = await lstatOrUndefined(directory);
  if (details !== undefined) {
    if (details.isSymbolicLink()) fail("patch_symlink_denied");
    if (!details.isDirectory()) fail("patch_output_nonregular_denied");
  }
}

async function writeOutputFile(
  outputRoot: string,
  segments: readonly string[],
  bytes: Uint8Array,
  expectedDigest: B1Digest,
): Promise<void> {
  const target = join(outputRoot, ...segments);
  const directory = dirname(target);

  await assertOutputPathUsable(outputRoot, segments);
  await mkdir(directory, { recursive: true });
  await assertOutputPathUsable(outputRoot, segments);

  const temporary = join(directory, `.${basename(target)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  const written = await readFile(target);
  if (digestOf(written) !== expectedDigest) fail("patch_output_digest_mismatch");
}

async function appendJournalEntry(
  outputRoot: string,
  journalRef: string,
  entry: PatchJournalEntry,
): Promise<void> {
  await assertJournalPathUsable(outputRoot);
  await mkdir(join(outputRoot, JOURNAL_DIRECTORY), { recursive: true });
  await assertJournalPathUsable(outputRoot);

  const target = journalPath(outputRoot, journalRef);
  const details = await lstatOrUndefined(target);
  if (details !== undefined) {
    if (details.isSymbolicLink()) fail("patch_symlink_denied");
    if (!details.isFile()) fail("patch_output_nonregular_denied");
    if (details.nlink > 1) fail("patch_output_hardlink_denied");
  }

  const handle = await open(target, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(entry)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function artifactIdFor(patchDigest: string, path: string, digest: string): string {
  return `patch-artifact:sha256:${createHash("sha256")
    .update(`${patchDigest}\n${path}\n${digest}`)
    .digest("hex")}`;
}

function assertJournalEntry(value: unknown, journalRef: string): PatchJournalEntry {
  if (typeof value !== "object" || value === null) fail("patch_journal_corrupt");
  const entry = value as Record<string, unknown>;
  if (entry.schemaVersion !== 1 || entry.journalRef !== journalRef) fail("patch_journal_corrupt");
  if (entry.state !== "applied" && entry.state !== "partially_applied") {
    fail("patch_journal_corrupt");
  }
  if (!isDigest(entry.patchDigest) || !Array.isArray(entry.resultByFile)) {
    fail("patch_journal_corrupt");
  }
  for (const result of entry.resultByFile) {
    if (typeof result !== "object" || result === null) fail("patch_journal_corrupt");
    const file = result as Record<string, unknown>;
    if (
      typeof file.path !== "string" ||
      (file.outcome !== "applied" && file.outcome !== "conflict") ||
      (file.resultDigest !== undefined && !isDigest(file.resultDigest))
    ) {
      fail("patch_journal_corrupt");
    }
  }
  if (typeof entry.actualBaseDigests !== "object" || entry.actualBaseDigests === null) {
    fail("patch_journal_corrupt");
  }
  for (const digest of Object.values(entry.actualBaseDigests)) {
    if (digest !== null && !isDigest(digest)) fail("patch_journal_corrupt");
  }
  if (!Array.isArray(entry.outputArtifacts)) fail("patch_journal_corrupt");
  for (const artifact of entry.outputArtifacts) {
    if (typeof artifact !== "object" || artifact === null) fail("patch_journal_corrupt");
    const metadata = artifact as Record<string, unknown>;
    if (typeof metadata.path !== "string" || !isDigest(metadata.digest)) {
      fail("patch_journal_corrupt");
    }
  }
  return entry as unknown as PatchJournalEntry;
}

export async function applyPatchToDirectory(
  input: ApplyPatchToDirectoryInput,
): Promise<PatchFilesystemResult> {
  const independentGrantId = assertNonEmpty(input.independentGrantId, "independent_grant_required");
  const journalRef = assertNonEmpty(input.journalRef, "patch_journal_ref_required");
  if (input.proposal.fileChanges.length === 0) fail("patch_selection_required");

  const sourceRoot = await resolveSourceRoot(input.sourceRoot);
  const outputRoot = await resolveOutputRoot(input.outputRoot);
  if (isWithin(sourceRoot, outputRoot) || isWithin(outputRoot, sourceRoot)) {
    fail("patch_output_not_isolated");
  }

  const seen = new Set<string>();
  const changes: { change: B1PatchProposal["fileChanges"][number]; segments: readonly string[] }[] =
    [];
  for (const change of input.proposal.fileChanges) {
    if (change.changeType !== "update") fail("patch_change_type_unsupported");
    if (change.path.length === 0 || seen.has(change.path)) fail("patch_path_denied");
    seen.add(change.path);
    const segments = safeSegments(change.path);
    if (digestOf(change.replacementContent) !== change.replacementDigest) {
      fail("patch_replacement_digest_mismatch");
    }
    changes.push({ change, segments });
  }

  const planned: PlannedChange[] = [];
  for (const { change, segments } of changes) {
    const source = await readSourceFile(sourceRoot, segments);
    const actualBaseDigest = source?.digest ?? null;
    const callerDigest = input.currentFileDigests?.[change.path];
    const verifiedByCaller =
      input.currentFileDigests === undefined || callerDigest === actualBaseDigest;
    planned.push({
      change,
      segments,
      actualBaseDigest,
      conflict: actualBaseDigest !== change.baseDigest || !verifiedByCaller,
    });
  }

  const actualBaseDigests = Object.fromEntries(
    planned.map(({ change, actualBaseDigest }) => [change.path, actualBaseDigest]),
  ) as Record<string, B1Digest | null>;
  const results: PatchFilesystemFileResult[] = planned.map(({ change, conflict }) =>
    conflict
      ? { path: change.path, outcome: "conflict" }
      : {
          path: change.path,
          outcome: "applied",
          resultDigest: change.replacementDigest,
        },
  );

  const writeCount = results.filter((result) => result.outcome === "applied").length;
  if (writeCount === 0) {
    return {
      state: "conflict",
      resultByFile: results,
      actualBaseDigests,
      journalRef,
      writeCount: 0,
      outputArtifactVersions: 0,
      outputArtifacts: [],
      autoMerge: false,
      writebackToSource: false,
    };
  }

  const state = writeCount === results.length ? "applied" : "partially_applied";
  for (const { segments, conflict } of planned) {
    if (conflict) continue;
    await assertOutputPathUsable(outputRoot, segments);
  }
  await assertJournalPathUsable(outputRoot);

  const artifacts = new Map<string, PatchOutputArtifact>();
  for (const { change, segments, conflict } of planned) {
    if (conflict) continue;
    const bytes = new TextEncoder().encode(change.replacementContent);
    await writeOutputFile(outputRoot, segments, bytes, change.replacementDigest);
    artifacts.set(change.path, {
      artifactId: artifactIdFor(input.proposal.patchDigest, change.path, change.replacementDigest),
      kind: "patch",
      path: change.path,
      digest: change.replacementDigest,
      size: bytes.byteLength,
      mediaType: "text/plain",
    });
  }

  const outputArtifacts = results
    .map((result) => artifacts.get(result.path))
    .filter((artifact): artifact is PatchOutputArtifact => artifact !== undefined);

  const entry: PatchJournalEntry = {
    schemaVersion: 1,
    journalRef,
    patchId: input.proposal.id,
    patchDigest: input.proposal.patchDigest,
    independentGrantId,
    state,
    resultByFile: results,
    actualBaseDigests,
    outputArtifacts,
    writebackToSource: false,
    autoMerge: false,
    recordedAt: new Date().toISOString(),
  };
  await appendJournalEntry(outputRoot, journalRef, entry);

  return {
    state,
    resultByFile: results,
    actualBaseDigests,
    journalRef,
    writeCount,
    outputArtifactVersions: outputArtifacts.length,
    outputArtifacts,
    autoMerge: false,
    writebackToSource: false,
  };
}

export async function readPatchJournal(
  input: ReadPatchJournalInput,
): Promise<readonly PatchJournalEntry[]> {
  const journalRef = assertNonEmpty(input.journalRef, "patch_journal_ref_required");
  const outputRoot = await resolveOutputRoot(input.outputRoot);
  await assertJournalPathUsable(outputRoot);
  const target = journalPath(outputRoot, journalRef);
  const details = await lstatOrUndefined(target);
  if (details === undefined) return [];
  if (details.isSymbolicLink()) fail("patch_symlink_denied");
  if (!details.isFile()) fail("patch_output_nonregular_denied");
  if (details.nlink > 1) fail("patch_output_hardlink_denied");

  const lines = (await readFile(target, "utf8")).split("\n").filter((line) => line.length > 0);
  return lines.map((line) => {
    try {
      return assertJournalEntry(JSON.parse(line) as unknown, journalRef);
    } catch (error) {
      if (error instanceof SyntaxError) fail("patch_journal_corrupt");
      throw error;
    }
  });
}

export async function readPatchArtifact(input: ReadPatchArtifactInput): Promise<Uint8Array> {
  if (!isDigest(input.artifact.digest)) fail("patch_artifact_digest_invalid");
  const segments = safeSegments(input.artifact.path);
  const outputRoot = await resolveOutputRoot(input.outputRoot);

  let cursor = outputRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    const details = await lstatOrUndefined(cursor);
    if (details === undefined) fail("patch_artifact_not_found");
    if (details.isSymbolicLink()) fail("patch_symlink_denied");
    if (index < segments.length - 1) {
      if (!details.isDirectory()) fail("patch_output_parent_denied");
      continue;
    }
    if (!details.isFile()) fail("patch_output_nonregular_denied");
    if (details.nlink > 1) fail("patch_output_hardlink_denied");
  }

  const bytes = await readFile(cursor);
  if (digestOf(bytes) !== input.artifact.digest) fail("patch_output_digest_mismatch");
  return bytes;
}
