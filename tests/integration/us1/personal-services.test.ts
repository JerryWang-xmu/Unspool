import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactService } from "../../../apps/runner-api/src/artifacts/service.js";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service.js";
import { RunsService } from "../../../apps/runner-api/src/runs/service.js";
import { DEFAULT_ARTIFACT_UPLOAD_LIMIT_BYTES } from "../../../packages/domain/src/artifact-version.js";
import { uuidv7 } from "../../../packages/security/src/uuid.js";

const DIGEST = `sha256:${"1".repeat(64)}`;
const OWNER = uuidv7();
const RUNNER = uuidv7();
const PROFILE = uuidv7();
const temporary: string[] = [];

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "unspool-us1-services-"));
  temporary.push(dataDir);
  const opened = await openPersonalService({ dataDir, runnerId: RUNNER, agentProfileId: PROFILE });
  const created = await opened.service.createTask(
    OWNER,
    {
      name: "Service integration",
      goal: "Exercise every personal command",
      completionCriteria: "All commands persist",
      runnerId: RUNNER,
      agentProfileId: PROFILE,
      payloadDigest: DIGEST,
    },
    uuidv7(),
  );
  return { ...opened, workspaceId: String(created.response.workspace.id) };
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("US1 personal and run services", () => {
  it("searches, pins, archives, reopens, and persists run queue/stop/result commands", async () => {
    const opened = await fixture();
    try {
      const workspaceId = opened.workspaceId;
      expect((await opened.service.setPinned(OWNER, workspaceId, true)).workspace.pinned).toBe(
        true,
      );
      expect(
        (await opened.service.listTasks(OWNER, { search: "every personal" })).personalTasks,
      ).toHaveLength(1);
      expect((await opened.service.setArchived(OWNER, workspaceId, true)).workspace.status).toBe(
        "archived",
      );
      expect((await opened.service.listTasks(OWNER)).personalTasks).toHaveLength(0);
      expect(
        (await opened.service.listTasks(OWNER, { includeArchived: true })).personalTasks,
      ).toHaveLength(1);
      expect((await opened.service.setArchived(OWNER, workspaceId, false)).workspace.status).toBe(
        "active",
      );

      const runs = new RunsService({ database: opened.database });
      const started = await runs.startRun(
        OWNER,
        workspaceId,
        { operatorEpoch: 1, body: "Run", payloadDigest: DIGEST },
        uuidv7(),
      );
      const runId = String(started.response.run.id);
      const steer = await runs.enqueue(
        OWNER,
        workspaceId,
        runId,
        "steer",
        { operatorEpoch: 1, body: "Steer", payloadDigest: DIGEST },
        uuidv7(),
      );
      const followUp = await runs.enqueue(
        OWNER,
        workspaceId,
        runId,
        "follow_up",
        { operatorEpoch: 1, body: "Follow up", payloadDigest: DIGEST },
        uuidv7(),
      );
      expect(steer.response.queuedInstruction.position).toBe(1);
      expect(followUp.response.queuedInstruction.position).toBe(2);
      await runs.queueAction(
        OWNER,
        workspaceId,
        runId,
        {
          queuedInstructionId: String(followUp.response.queuedInstruction.id),
          action: "modify",
          editedBody: "Edited",
          operatorEpoch: 1,
          payloadDigest: DIGEST,
        },
        uuidv7(),
      );
      await runs.queueAction(
        OWNER,
        workspaceId,
        runId,
        {
          queuedInstructionId: String(followUp.response.queuedInstruction.id),
          action: "release",
          operatorEpoch: 1,
          payloadDigest: DIGEST,
        },
        uuidv7(),
      );
      expect(
        (
          await runs.stop(
            OWNER,
            workspaceId,
            runId,
            { operatorEpoch: 1, confirmedStop: true, payloadDigest: DIGEST },
            uuidv7(),
          )
        ).response.queuedInstructionsWithheld,
      ).toBe(true);
      expect(
        (
          await runs.assessResult(
            OWNER,
            workspaceId,
            runId,
            { result: "partial", reason: "Needs review", payloadDigest: DIGEST },
            uuidv7(),
          )
        ).response.assessment,
      ).toMatchObject({ runId, result: "partial", assessedBy: OWNER });
      expect((await runs.listRuns(OWNER, workspaceId)).runs).toHaveLength(1);
    } finally {
      await opened.close();
    }
  });

  it("versions and previews artifacts, deduplicates blobs, and enforces upload limits", async () => {
    const opened = await fixture();
    try {
      const artifacts = new ArtifactService({
        database: opened.database,
        dataDir: opened.database.filename.replace(/[\\/]unspool\.sqlite$/, ""),
      });
      expect(artifacts.maxUploadBytes).toBe(DEFAULT_ARTIFACT_UPLOAD_LIMIT_BYTES);
      const bytes = new TextEncoder().encode("# Version one\n");
      const metadata = {
        name: "report.md",
        mediaType: "text/markdown",
        size: bytes.byteLength,
        sha256: `sha256:${"0".repeat(64)}`,
        kind: "reference" as const,
        sourceSummary: "Integration artifact",
      };
      const actualDigest =
        "sha256:24606f7dcdc722a035240e67d4c99928d02c085e851f63a7eb0f8578d00da427";
      const first = await artifacts.upload(
        OWNER,
        opened.workspaceId,
        { ...metadata, sha256: actualDigest },
        bytes,
        uuidv7(),
      );
      const artifactId = String(first.response.artifact.artifactId);
      const secondBytes = new TextEncoder().encode("# Version two\n");
      const secondDigest =
        "sha256:e51f28c94b5f8eb38baa2d380b069a15ee2d96b7fe17d99c62830dc3237b7b52";
      const second = await artifacts.upload(
        OWNER,
        opened.workspaceId,
        { ...metadata, size: secondBytes.byteLength, sha256: secondDigest },
        secondBytes,
        uuidv7(),
        artifactId,
      );
      expect(second.response.artifact.version).toBe(2);
      expect((await artifacts.get(OWNER, opened.workspaceId, artifactId)).version).toBe(2);
      expect((await artifacts.get(OWNER, opened.workspaceId, artifactId, 1)).sha256).toBe(
        actualDigest,
      );
      expect(
        (await artifacts.preview(OWNER, opened.workspaceId, artifactId, 1)).preview,
      ).toMatchObject({ kind: "text", text: "# Version one\n" });
      expect((await artifacts.list(OWNER, opened.workspaceId)).artifacts).toHaveLength(2);

      await artifacts.upload(
        OWNER,
        opened.workspaceId,
        { ...metadata, sha256: actualDigest },
        bytes,
        uuidv7(),
      );
      const blobs = await opened.database.query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM blob_object WHERE sha256 = ?",
        [actualDigest],
      );
      expect(blobs[0]?.count).toBe(1);
      const limited = new ArtifactService({
        database: opened.database,
        dataDir: opened.database.filename.replace(/[\\/]unspool\.sqlite$/, ""),
        maxUploadBytes: 4,
      });
      await expect(
        limited.upload(OWNER, opened.workspaceId, metadata, bytes, uuidv7()),
      ).rejects.toMatchObject({ code: "budget_exhausted" });
    } finally {
      await opened.close();
    }
  });
});
