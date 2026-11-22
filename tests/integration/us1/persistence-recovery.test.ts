/**
 * T050 / US1 / QS-01.3-4 / UAT-26, UAT-29.
 *
 * RED integration coverage for personal history, Run, artifact and session
 * checkpoint recovery, plus cold backup and empty-host restore. Every scenario
 * uses a temporary dataDir and drives the local maintenance/persistence seams;
 * it deliberately does not invent an HTTP backup endpoint.
 *
 * Planned seams:
 * - apps/runner-api/src/personal/repository.ts (T071, T072, T079)
 * - apps/runner-api/src/maintenance/backup.ts (T081)
 * - apps/runner-api/src/maintenance/restore.ts (T081)
 *
 * Expected repository contract:
 *   openPersonalRepository({ dataDir }) => {
 *     close(), createTask(input), startConversation(input), appendRun(input),
 *     saveCheckpoint(input), saveArtifact(input), resumeTask(workspaceId),
 *     listRecentTasks({ limit? })
 *   }
 *
 * Expected maintenance contract:
 *   createColdBackup({ dataDir, backupDir, appVersion, now }) =>
 *     { manifest, manifestPath }
 *   restoreColdBackup({ backupDir, dataDir, now }) =>
 *     { ok, manifest?, error?, missingObjects, digestMismatches }
 *
 * BackupManifest carries the canonical fields: id, appVersion, schemaVersion,
 * lastWorkspaceSequences (workspaceId -> last sequence), objectEntries,
 * sessionEntries, createdAt and digest. Object entries expose objectId,
 * relativePath, sha256 and size. Session entries expose conversationId,
 * relativePath, sha256 and size. Paths are relative to backupDir. Restore
 * validates the backup before inspecting or mutating the target so a corrupt
 * backup is reported even when the target already contains data.
 *
 * These tests must fail with an explicit missing-module message until the
 * planned files exist; they must not be satisfied by a fake HTTP backup API.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const NOW = "2026-11-22T10:00:00.000Z";
const T1 = "2026-11-22T08:00:00.000Z";
const T2 = "2026-11-22T08:10:00.000Z";
const T3 = "2026-11-22T08:20:00.000Z";
const T4 = "2026-11-22T08:30:00.000Z";
const T5 = "2026-11-22T08:40:00.000Z";
const T6 = "2026-11-22T08:50:00.000Z";
const T7 = "2026-11-22T09:00:00.000Z";
const T8 = "2026-11-22T09:10:00.000Z";
const T9 = "2026-11-22T09:20:00.000Z";

const USER_ID = "018f2d8f-3000-7f20-80b1-aaaaaaaaaaa0";
const RUNNER_ID = "018f2d8f-3001-7f20-80b1-aaaaaaaaaaa1";
const WORKSPACE_A = "018f2d8f-3002-7f20-80b1-aaaaaaaaaaa2";
const WORKSPACE_B = "018f2d8f-3003-7f20-80b1-aaaaaaaaaaa3";
const CONVERSATION_A = "018f2d8f-3004-7f20-80b1-aaaaaaaaaaa4";
const CONVERSATION_B = "018f2d8f-3005-7f20-80b1-aaaaaaaaaaa5";
const RUN_A1 = "018f2d8f-3006-7f20-80b1-aaaaaaaaaaa6";
const RUN_A2 = "018f2d8f-3007-7f20-80b1-aaaaaaaaaaa7";
const RUN_B1 = "018f2d8f-3008-7f20-80b1-aaaaaaaaaaa8";
const CHECKPOINT_A1 = "018f2d8f-3009-7f20-80b1-aaaaaaaaaaa9";
const CHECKPOINT_A2 = "018f2d8f-300a-7f20-80b1-aaaaaaaaaaaa";
const CHECKPOINT_B1 = "018f2d8f-300b-7f20-80b1-aaaaaaaaaaab";
const CONTEXT_A1 = "018f2d8f-300c-7f20-80b1-aaaaaaaaaaac";
const CONTEXT_A2 = "018f2d8f-300d-7f20-80b1-aaaaaaaaaaad";
const CONTEXT_B1 = "018f2d8f-300e-7f20-80b1-aaaaaaaaaaae";
const ARTIFACT_A = "018f2d8f-300f-7f20-80b1-aaaaaaaaaaaf";
const ARTIFACT_B = "018f2d8f-3010-7f20-80b1-aaaaaaaaaab0";

const SESSION_A_REF = "sessions/conversation-a.jsonl";
const SESSION_B_REF = "sessions/conversation-b.jsonl";
const SESSION_A = [
  JSON.stringify({ type: "session", version: 1, id: CONVERSATION_A }),
  JSON.stringify({ type: "message", id: "entry-a-1", body: "Alpha one" }),
  JSON.stringify({ type: "message", id: "entry-a-2", body: "Alpha two" }),
  "",
].join("\n");
const SESSION_B = [
  JSON.stringify({ type: "session", version: 1, id: CONVERSATION_B }),
  JSON.stringify({ type: "message", id: "entry-b-1", body: "Beta one" }),
  "",
].join("\n");

const ALPHA_V1_BYTES = Buffer.from("alpha artifact version one\n", "utf8");
const ALPHA_V2_BYTES = Buffer.from("alpha artifact version two\n", "utf8");
const BETA_BYTES = Buffer.from("beta artifact\n", "utf8");

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

type JsonRecord = Record<string, unknown>;

type DigestMismatch = {
  objectId: string;
  expectedSha256: string;
  actualSha256: string;
};

type BackupObjectEntry = {
  objectId: string;
  relativePath: string;
  sha256: string;
  size: number;
};

type BackupSessionEntry = {
  conversationId: string;
  relativePath: string;
  sha256: string;
  size: number;
};

type BackupManifest = {
  id: string;
  appVersion: string;
  schemaVersion: number;
  lastWorkspaceSequences: Record<string, number>;
  objectEntries: BackupObjectEntry[];
  sessionEntries: BackupSessionEntry[];
  createdAt: string;
  digest: string;
};

type ColdBackupResult = {
  manifest: BackupManifest;
  manifestPath: string;
};

type RestoreResult = {
  ok: boolean;
  manifest?: BackupManifest;
  error?: { code: string; detail?: string };
  missingObjects: string[];
  digestMismatches: DigestMismatch[];
};

type ArtifactRecord = JsonRecord & {
  artifactVersionId: string;
  artifactId: string;
  version: number;
  name: string;
  mediaType: string;
  sha256: string;
  size: number;
  status: "ok" | "missing" | "digest_mismatch";
  bytes: Uint8Array;
};

type ResumedTask = {
  workspace: JsonRecord;
  conversation: JsonRecord;
  run: JsonRecord;
  checkpoint: JsonRecord;
  artifacts: ArtifactRecord[];
};

type RecentTask = {
  workspaceId: string;
  name: string;
  latestRunId: string;
  latestCheckpointId: string;
  updatedAt: string;
};

type PersonalRepository = {
  close(): Promise<void>;
  createTask(input: JsonRecord): Promise<unknown>;
  startConversation(input: JsonRecord): Promise<unknown>;
  appendRun(input: JsonRecord): Promise<unknown>;
  saveCheckpoint(input: JsonRecord): Promise<unknown>;
  saveArtifact(input: JsonRecord): Promise<{
    artifactVersionId: string;
    blobId: string;
    sha256: string;
    size: number;
  }>;
  resumeTask(workspaceId: string): Promise<ResumedTask | null>;
  listRecentTasks(options?: { limit?: number }): Promise<RecentTask[]>;
};

type Us1Modules = {
  openPersonalRepository(options: { dataDir: string }): Promise<PersonalRepository>;
  createColdBackup(options: {
    dataDir: string;
    backupDir: string;
    appVersion: string;
    now?: string;
  }): Promise<ColdBackupResult>;
  restoreColdBackup(options: {
    backupDir: string;
    dataDir: string;
    now?: string;
  }): Promise<RestoreResult>;
};

type SeededArtifact = {
  artifactVersionId: string;
  blobId: string;
  sha256: string;
  size: number;
  bytes: Buffer;
};

type SeededHistory = {
  alphaV1: SeededArtifact;
  alphaV2: SeededArtifact;
  beta: SeededArtifact;
};

let modules: Us1Modules;
const temporaryDirectories: string[] = [];

function digestOf(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function makeTemporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `unspool-us1-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function loadModule(relativePath: string, task: string): Promise<JsonRecord> {
  const absolutePath = resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `US1 persistence-recovery implementation is missing: ${relativePath} (${task}). ` +
        "T050 must stay red until the personal repository and cold-backup maintenance " +
        "modules exist; do not replace them with a fake HTTP backup API.",
    );
  }
  return (await import(pathToFileURL(absolutePath).href)) as JsonRecord;
}

function requireFunction(
  module: JsonRecord,
  name: string,
  source: string,
  signature: string,
): (...args: unknown[]) => unknown {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`${source} must export ${signature}`);
  }
  return value as (...args: unknown[]) => unknown;
}

async function loadUs1Modules(): Promise<Us1Modules> {
  const repositorySource = "apps/runner-api/src/personal/repository.ts";
  const repository = await loadModule(repositorySource, "T071");
  const openPersonalRepository = requireFunction(
    repository,
    "openPersonalRepository",
    repositorySource,
    "openPersonalRepository({ dataDir })",
  );

  const backupSource = "apps/runner-api/src/maintenance/backup.ts";
  const backup = await loadModule(backupSource, "T081");
  const createColdBackup = requireFunction(
    backup,
    "createColdBackup",
    backupSource,
    "createColdBackup({ dataDir, backupDir, appVersion, now })",
  );

  const restoreSource = "apps/runner-api/src/maintenance/restore.ts";
  const restore = await loadModule(restoreSource, "T081");
  const restoreColdBackup = requireFunction(
    restore,
    "restoreColdBackup",
    restoreSource,
    "restoreColdBackup({ backupDir, dataDir, now })",
  );

  return {
    openPersonalRepository,
    createColdBackup,
    restoreColdBackup,
  } as unknown as Us1Modules;
}

function backupPath(backupDir: string, relativePath: string): string {
  const absolutePath = resolve(backupDir, relativePath);
  expect(absolutePath.startsWith(`${resolve(backupDir)}${sep}`)).toBe(true);
  return absolutePath;
}

async function writeSession(dataDir: string, reference: string, contents: string): Promise<void> {
  const absolutePath = join(dataDir, reference);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function seedPersonalHistory(dataDir: string): Promise<SeededHistory> {
  const repository = await modules.openPersonalRepository({ dataDir });
  try {
    await repository.createTask({
      id: WORKSPACE_A,
      kind: "personal",
      teamId: null,
      ownerId: USER_ID,
      runnerId: RUNNER_ID,
      name: "Alpha personal task",
      goal: "Produce the alpha report",
      completionCriteria: "Alpha report and code diff are saved",
      status: "active",
      visibility: "private",
      agentConfigSnapshot: {
        provider: "faux",
        model: "faux-model",
        tools: ["read_file", "write_file"],
      },
      federationMode: "disabled",
      revision: 1,
      createdAt: T1,
    });
    await repository.createTask({
      id: WORKSPACE_B,
      kind: "personal",
      teamId: null,
      ownerId: USER_ID,
      runnerId: RUNNER_ID,
      name: "Beta personal task",
      goal: "Produce the beta report",
      completionCriteria: "Beta report is saved",
      status: "active",
      visibility: "private",
      agentConfigSnapshot: {
        provider: "faux",
        model: "faux-model",
        tools: ["read_file"],
      },
      federationMode: "disabled",
      revision: 1,
      createdAt: T2,
    });

    await repository.startConversation({
      id: CONVERSATION_A,
      workspaceId: WORKSPACE_A,
      piSessionRef: SESSION_A_REF,
      sessionFormatVersion: 1,
      createdAt: T1,
    });
    await repository.startConversation({
      id: CONVERSATION_B,
      workspaceId: WORKSPACE_B,
      piSessionRef: SESSION_B_REF,
      sessionFormatVersion: 1,
      createdAt: T2,
    });
    await writeSession(dataDir, SESSION_A_REF, SESSION_A);
    await writeSession(dataDir, SESSION_B_REF, SESSION_B);

    await repository.appendRun({
      id: RUN_A1,
      workspaceId: WORKSPACE_A,
      conversationId: CONVERSATION_A,
      sequence: 1,
      state: "cancelled",
      operatorEpoch: 1,
      runnerId: RUNNER_ID,
      contextSnapshotId: CONTEXT_A1,
      startedBy: USER_ID,
      startedAt: T3,
      endedAt: T4,
    });
    await repository.appendRun({
      id: RUN_A2,
      workspaceId: WORKSPACE_A,
      conversationId: CONVERSATION_A,
      sequence: 2,
      state: "technical_complete",
      operatorEpoch: 1,
      runnerId: RUNNER_ID,
      contextSnapshotId: CONTEXT_A2,
      startedBy: USER_ID,
      startedAt: T5,
      endedAt: T6,
    });
    await repository.appendRun({
      id: RUN_B1,
      workspaceId: WORKSPACE_B,
      conversationId: CONVERSATION_B,
      sequence: 1,
      state: "running",
      operatorEpoch: 1,
      runnerId: RUNNER_ID,
      contextSnapshotId: CONTEXT_B1,
      startedBy: USER_ID,
      startedAt: T7,
    });

    await repository.saveCheckpoint({
      id: CHECKPOINT_A1,
      conversationId: CONVERSATION_A,
      runId: RUN_A1,
      piLeafId: "leaf-a-1",
      lastPersistedEntryId: "entry-a-1",
      lastProjectedEventId: "event-a-1",
      createdAt: T4,
    });
    await repository.saveCheckpoint({
      id: CHECKPOINT_A2,
      conversationId: CONVERSATION_A,
      runId: RUN_A2,
      piLeafId: "leaf-a-2",
      lastPersistedEntryId: "entry-a-2",
      lastProjectedEventId: "event-a-2",
      createdAt: T6,
    });
    await repository.saveCheckpoint({
      id: CHECKPOINT_B1,
      conversationId: CONVERSATION_B,
      runId: RUN_B1,
      piLeafId: "leaf-b-1",
      lastPersistedEntryId: "entry-b-1",
      lastProjectedEventId: "event-b-1",
      createdAt: T9,
    });

    const alphaV1Saved = await repository.saveArtifact({
      workspaceId: WORKSPACE_A,
      runId: RUN_A2,
      artifactId: ARTIFACT_A,
      version: 1,
      kind: "agent_output",
      originType: "run",
      originId: RUN_A2,
      name: "alpha-report.md",
      mediaType: "text/markdown",
      sourceSummary: "Alpha report generated by the personal run",
      createdAt: T6,
      bytes: ALPHA_V1_BYTES,
    });
    const alphaV2Saved = await repository.saveArtifact({
      workspaceId: WORKSPACE_A,
      runId: RUN_A2,
      artifactId: ARTIFACT_A,
      version: 2,
      kind: "agent_output",
      originType: "run",
      originId: RUN_A2,
      name: "alpha-report.md",
      mediaType: "text/markdown",
      sourceSummary: "Alpha report with the accepted review change",
      createdAt: T7,
      bytes: ALPHA_V2_BYTES,
    });
    const betaSaved = await repository.saveArtifact({
      workspaceId: WORKSPACE_B,
      runId: RUN_B1,
      artifactId: ARTIFACT_B,
      version: 1,
      kind: "agent_output",
      originType: "run",
      originId: RUN_B1,
      name: "beta-report.md",
      mediaType: "text/markdown",
      sourceSummary: "Beta report generated by the personal run",
      createdAt: T8,
      bytes: BETA_BYTES,
    });

    for (const [label, saved, bytes] of [
      ["alpha v1", alphaV1Saved, ALPHA_V1_BYTES],
      ["alpha v2", alphaV2Saved, ALPHA_V2_BYTES],
      ["beta", betaSaved, BETA_BYTES],
    ] as const) {
      expect(saved.sha256, `${label} digest`).toBe(digestOf(bytes));
      expect(saved.size, `${label} size`).toBe(bytes.length);
      expect(saved.artifactVersionId, `${label} version id`).toMatch(UUID_V7_RE);
      expect(saved.blobId, `${label} blob id`).toMatch(UUID_V7_RE);
    }

    return {
      alphaV1: { ...alphaV1Saved, bytes: ALPHA_V1_BYTES },
      alphaV2: { ...alphaV2Saved, bytes: ALPHA_V2_BYTES },
      beta: { ...betaSaved, bytes: BETA_BYTES },
    };
  } finally {
    await repository.close();
  }
}

async function createBackupFixture(): Promise<{
  sourceDataDir: string;
  backupDir: string;
  manifest: BackupManifest;
  history: SeededHistory;
}> {
  const sourceDataDir = await makeTemporaryDirectory("source");
  const history = await seedPersonalHistory(sourceDataDir);
  const backupParent = await makeTemporaryDirectory("backup-parent");
  const backupDir = join(backupParent, "cold-backup");
  const backup = await modules.createColdBackup({
    dataDir: sourceDataDir,
    backupDir,
    appVersion: "0.1.0",
    now: NOW,
  });
  return { sourceDataDir, backupDir, manifest: backup.manifest, history };
}

async function copyBackup(backupDir: string, label: string): Promise<string> {
  const parent = await makeTemporaryDirectory(`corrupt-${label}`);
  const copy = join(parent, "cold-backup");
  await cp(backupDir, copy, { recursive: true });
  return copy;
}

async function writeExistingTarget(label: string): Promise<{
  dataDir: string;
  sentinelPath: string;
  existingDatabasePath: string;
  sentinel: string;
  existingDatabase: Buffer;
}> {
  const dataDir = await makeTemporaryDirectory(label);
  const sentinelPath = join(dataDir, "keep-me.txt");
  const existingDatabasePath = join(dataDir, "runner.sqlite");
  const sentinel = "Existing personal history must survive a failed restore.\n";
  const existingDatabase = Buffer.from("existing-runner-database-bytes", "utf8");
  await writeFile(sentinelPath, sentinel, "utf8");
  await writeFile(existingDatabasePath, existingDatabase);
  return { dataDir, sentinelPath, existingDatabasePath, sentinel, existingDatabase };
}

async function expectTargetPreserved(target: {
  sentinelPath: string;
  existingDatabasePath: string;
  sentinel: string;
  existingDatabase: Buffer;
}): Promise<void> {
  expect(await readFile(target.sentinelPath, "utf8")).toBe(target.sentinel);
  expect(await readFile(target.existingDatabasePath)).toEqual(target.existingDatabase);
}

beforeEach(async () => {
  modules = await loadUs1Modules();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("US1 personal history persistence", () => {
  it("reopens the exact task, latest Run, checkpoint and artifact bytes without opening another recent task", async () => {
    const dataDir = await makeTemporaryDirectory("reopen");
    const history = await seedPersonalHistory(dataDir);

    const repository = await modules.openPersonalRepository({ dataDir });
    try {
      const recent = await repository.listRecentTasks({ limit: 10 });
      expect(recent.map((task) => task.workspaceId)).toEqual([WORKSPACE_B, WORKSPACE_A]);
      expect(recent[0]).toMatchObject({
        workspaceId: WORKSPACE_B,
        name: "Beta personal task",
        latestRunId: RUN_B1,
        latestCheckpointId: CHECKPOINT_B1,
        updatedAt: T9,
      });
      expect(recent[1]).toMatchObject({
        workspaceId: WORKSPACE_A,
        name: "Alpha personal task",
        latestRunId: RUN_A2,
        latestCheckpointId: CHECKPOINT_A2,
        updatedAt: T7,
      });

      const alpha = await repository.resumeTask(WORKSPACE_A);
      expect(alpha).not.toBeNull();
      if (alpha === null) {
        throw new Error("resumeTask(WORKSPACE_A) returned null after reopening the same dataDir");
      }
      expect(alpha.workspace).toMatchObject({
        id: WORKSPACE_A,
        kind: "personal",
        teamId: null,
        ownerId: USER_ID,
        name: "Alpha personal task",
        goal: "Produce the alpha report",
        completionCriteria: "Alpha report and code diff are saved",
        status: "active",
        revision: 1,
        createdAt: T1,
      });
      expect(alpha.conversation).toMatchObject({
        id: CONVERSATION_A,
        workspaceId: WORKSPACE_A,
        piSessionRef: SESSION_A_REF,
        sessionFormatVersion: 1,
      });
      expect(alpha.run).toMatchObject({
        id: RUN_A2,
        workspaceId: WORKSPACE_A,
        conversationId: CONVERSATION_A,
        sequence: 2,
        state: "technical_complete",
        startedAt: T5,
        endedAt: T6,
      });
      expect(alpha.checkpoint).toMatchObject({
        id: CHECKPOINT_A2,
        conversationId: CONVERSATION_A,
        runId: RUN_A2,
        piLeafId: "leaf-a-2",
        lastPersistedEntryId: "entry-a-2",
        lastProjectedEventId: "event-a-2",
        createdAt: T6,
      });
      expect(alpha.checkpoint.id).not.toBe(CHECKPOINT_B1);

      const alphaVersionOne = alpha.artifacts.find((artifact) => artifact.version === 1);
      const alphaVersionTwo = alpha.artifacts.find((artifact) => artifact.version === 2);
      expect(alphaVersionOne).toBeDefined();
      expect(alphaVersionTwo).toBeDefined();
      if (alphaVersionOne === undefined || alphaVersionTwo === undefined) {
        throw new Error("Alpha artifact versions are missing after reopening the dataDir");
      }
      expect(alphaVersionOne).toMatchObject({
        artifactId: ARTIFACT_A,
        version: 1,
        name: "alpha-report.md",
        mediaType: "text/markdown",
        sha256: history.alphaV1.sha256,
        size: history.alphaV1.size,
        status: "ok",
      });
      expect(alphaVersionTwo).toMatchObject({
        artifactId: ARTIFACT_A,
        version: 2,
        sha256: history.alphaV2.sha256,
        size: history.alphaV2.size,
        status: "ok",
      });
      expect(Buffer.from(alphaVersionOne.bytes)).toEqual(history.alphaV1.bytes);
      expect(Buffer.from(alphaVersionTwo.bytes)).toEqual(history.alphaV2.bytes);

      const beta = await repository.resumeTask(WORKSPACE_B);
      expect(beta).not.toBeNull();
      if (beta === null) {
        throw new Error("resumeTask(WORKSPACE_B) returned null after reopening the dataDir");
      }
      expect(beta.run).toMatchObject({ id: RUN_B1, sequence: 1, state: "running" });
      expect(beta.checkpoint).toMatchObject({
        id: CHECKPOINT_B1,
        piLeafId: "leaf-b-1",
        lastPersistedEntryId: "entry-b-1",
      });
      expect(beta.artifacts).toHaveLength(1);
      expect(beta.artifacts[0]).toMatchObject({
        artifactId: ARTIFACT_B,
        sha256: history.beta.sha256,
        status: "ok",
      });
      expect(Buffer.from(beta.artifacts[0].bytes)).toEqual(history.beta.bytes);

      expect(await readFile(join(dataDir, SESSION_A_REF), "utf8")).toBe(SESSION_A);
      expect(await readFile(join(dataDir, SESSION_B_REF), "utf8")).toBe(SESSION_B);
    } finally {
      await repository.close();
    }
  });

  it("writes a cold backup manifest and restores the same history into an empty data directory", async () => {
    const dataDir = await makeTemporaryDirectory("backup-source");
    const history = await seedPersonalHistory(dataDir);
    const backupParent = await makeTemporaryDirectory("backup-parent");
    const backupDir = join(backupParent, "cold-backup");

    const backup = await modules.createColdBackup({
      dataDir,
      backupDir,
      appVersion: "0.1.0",
      now: NOW,
    });

    expect(backup.manifest.id).toMatch(UUID_V7_RE);
    expect(backup.manifest).toMatchObject({
      appVersion: "0.1.0",
      createdAt: NOW,
    });
    expect(Number.isInteger(backup.manifest.schemaVersion)).toBe(true);
    expect(backup.manifest.lastWorkspaceSequences).toEqual({
      [WORKSPACE_A]: 2,
      [WORKSPACE_B]: 1,
    });
    expect(backup.manifest.digest).toMatch(DIGEST_RE);
    expect(isAbsolute(backup.manifestPath)).toBe(true);
    expect(resolve(backup.manifestPath).startsWith(`${resolve(backupDir)}${sep}`)).toBe(true);
    const persistedManifest = JSON.parse(await readFile(backup.manifestPath, "utf8"));
    expect(persistedManifest).toEqual(backup.manifest);

    const alphaObjectEntry = backup.manifest.objectEntries.find(
      (entry) => entry.sha256 === history.alphaV1.sha256,
    );
    expect(alphaObjectEntry).toBeDefined();
    if (alphaObjectEntry === undefined) {
      throw new Error("Cold backup manifest does not contain the alpha artifact object");
    }
    expect(alphaObjectEntry).toMatchObject({
      objectId: history.alphaV1.blobId,
      sha256: history.alphaV1.sha256,
      size: history.alphaV1.size,
    });
    expect(await readFile(backupPath(backupDir, alphaObjectEntry.relativePath))).toEqual(
      history.alphaV1.bytes,
    );

    const sessionEntryA = backup.manifest.sessionEntries.find(
      (entry) => entry.conversationId === CONVERSATION_A,
    );
    expect(sessionEntryA).toBeDefined();
    if (sessionEntryA === undefined) {
      throw new Error("Cold backup manifest does not contain the alpha session entry");
    }
    const backedUpSessionA = await readFile(backupPath(backupDir, sessionEntryA.relativePath));
    expect(digestOf(backedUpSessionA)).toBe(sessionEntryA.sha256);
    expect(backedUpSessionA.length).toBe(sessionEntryA.size);
    expect(backedUpSessionA.toString("utf8")).toBe(SESSION_A);

    const restoredDir = await makeTemporaryDirectory("restored");
    const restore = await modules.restoreColdBackup({
      backupDir,
      dataDir: restoredDir,
      now: NOW,
    });
    expect(restore.ok).toBe(true);
    expect(restore.error).toBeUndefined();
    expect(restore.missingObjects).toEqual([]);
    expect(restore.digestMismatches).toEqual([]);
    expect(restore.manifest?.id).toBe(backup.manifest.id);

    const repository = await modules.openPersonalRepository({ dataDir: restoredDir });
    try {
      const recent = await repository.listRecentTasks({ limit: 10 });
      expect(recent.map((task) => task.workspaceId)).toEqual([WORKSPACE_B, WORKSPACE_A]);

      const alpha = await repository.resumeTask(WORKSPACE_A);
      expect(alpha).not.toBeNull();
      if (alpha === null) {
        throw new Error("The restored data directory cannot resume the alpha personal task");
      }
      expect(alpha.workspace).toMatchObject({
        id: WORKSPACE_A,
        name: "Alpha personal task",
        goal: "Produce the alpha report",
        completionCriteria: "Alpha report and code diff are saved",
        revision: 1,
      });
      expect(alpha.conversation).toMatchObject({
        id: CONVERSATION_A,
        piSessionRef: SESSION_A_REF,
      });
      expect(alpha.run).toMatchObject({ id: RUN_A2, sequence: 2, state: "technical_complete" });
      expect(alpha.checkpoint).toMatchObject({
        id: CHECKPOINT_A2,
        piLeafId: "leaf-a-2",
        lastPersistedEntryId: "entry-a-2",
        lastProjectedEventId: "event-a-2",
      });
      expect(alpha.artifacts.map((artifact) => artifact.version)).toEqual([1, 2]);
      expect(Buffer.from(alpha.artifacts[0].bytes)).toEqual(history.alphaV1.bytes);
      expect(Buffer.from(alpha.artifacts[1].bytes)).toEqual(history.alphaV2.bytes);

      const beta = await repository.resumeTask(WORKSPACE_B);
      expect(beta).not.toBeNull();
      if (beta === null) {
        throw new Error("The restored data directory cannot resume the beta personal task");
      }
      expect(beta.run).toMatchObject({ id: RUN_B1, sequence: 1, state: "running" });
      expect(beta.checkpoint).toMatchObject({ id: CHECKPOINT_B1, piLeafId: "leaf-b-1" });
      expect(Buffer.from(beta.artifacts[0].bytes)).toEqual(history.beta.bytes);

      expect(await readFile(join(restoredDir, SESSION_A_REF), "utf8")).toBe(SESSION_A);
      expect(await readFile(join(restoredDir, SESSION_B_REF), "utf8")).toBe(SESSION_B);
    } finally {
      await repository.close();
    }
  });

  it("reports a missing backup object explicitly and preserves an existing target data directory", async () => {
    const { backupDir, manifest, history } = await createBackupFixture();
    const corruptBackupDir = await copyBackup(backupDir, "missing-object");
    const objectEntry = manifest.objectEntries.find(
      (entry) => entry.sha256 === history.alphaV1.sha256,
    );
    expect(objectEntry).toBeDefined();
    if (objectEntry === undefined) {
      throw new Error("Cold backup manifest does not contain the alpha artifact object");
    }
    await rm(backupPath(corruptBackupDir, objectEntry.relativePath));

    const target = await writeExistingTarget("target-missing-object");
    const restore = await modules.restoreColdBackup({
      backupDir: corruptBackupDir,
      dataDir: target.dataDir,
      now: NOW,
    });

    expect(restore.ok).toBe(false);
    expect(restore.error?.code).toBe("backup_invalid");
    expect(restore.missingObjects).toContain(objectEntry.objectId);
    expect(restore.digestMismatches).toEqual([]);
    await expectTargetPreserved(target);
  });

  it("reports a digest mismatch with expected and actual digests while preserving the target", async () => {
    const { backupDir, manifest, history } = await createBackupFixture();
    const corruptBackupDir = await copyBackup(backupDir, "digest-mismatch");
    const objectEntry = manifest.objectEntries.find(
      (entry) => entry.sha256 === history.alphaV2.sha256,
    );
    expect(objectEntry).toBeDefined();
    if (objectEntry === undefined) {
      throw new Error("Cold backup manifest does not contain the alpha v2 artifact object");
    }

    const objectPath = backupPath(corruptBackupDir, objectEntry.relativePath);
    const originalBytes = await readFile(objectPath);
    const tamperedBytes = Buffer.from(originalBytes);
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;
    expect(tamperedBytes).toHaveLength(originalBytes.length);
    const actualSha256 = digestOf(tamperedBytes);
    expect(actualSha256).not.toBe(objectEntry.sha256);
    await writeFile(objectPath, tamperedBytes);

    const target = await writeExistingTarget("target-digest-mismatch");
    const restore = await modules.restoreColdBackup({
      backupDir: corruptBackupDir,
      dataDir: target.dataDir,
      now: NOW,
    });

    expect(restore.ok).toBe(false);
    expect(restore.error?.code).toBe("backup_invalid");
    expect(restore.missingObjects).toEqual([]);
    expect(restore.digestMismatches).toContainEqual({
      objectId: objectEntry.objectId,
      expectedSha256: objectEntry.sha256,
      actualSha256,
    });
    await expectTargetPreserved(target);
  });

  it("refuses a valid restore over an existing data directory instead of silently clearing it", async () => {
    const { backupDir } = await createBackupFixture();
    const target = await writeExistingTarget("target-nonempty");

    const restore = await modules.restoreColdBackup({
      backupDir,
      dataDir: target.dataDir,
      now: NOW,
    });

    expect(restore.ok).toBe(false);
    expect(restore.error?.code).toBe("target_not_empty");
    expect(restore.missingObjects).toEqual([]);
    expect(restore.digestMismatches).toEqual([]);
    await expectTargetPreserved(target);
    expect(existsSync(join(target.dataDir, "sessions"))).toBe(false);
  });
});
