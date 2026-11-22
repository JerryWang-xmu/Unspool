import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before, describe } from "node:test";

/**
 * US5 completion-gate and archive-export integration tests.
 *
 * Covered acceptance scenarios:
 * - spec US5.4 / UAT-19 / QS-05.3: missing, invalid, or review-required evidence
 *   blocks an untruthful "complete" decision. The user may supplement evidence,
 *   choose partial completion, or record an owner exception that keeps the risk
 *   and does not count as valid coverage.
 * - spec US5.5 / UAT-17 / QS-05.4: archiving makes the workspace read-only;
 *   the exported manifest is readable with generic tools, artifacts correspond
 *   to manifest entries, and missing/truncated/inaccessible/unknown items are
 *   explicit.
 * - data-model: ArchiveExport records scope, formatVersion, manifestBlobId,
 *   missingItems[], unknownItems[], exporter, and export time.
 */

type Us5Error = {
  status: number;
  code: string;
  detail?: string;
  revision?: number;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: Us5Error };

type WorkspaceRole = "owner" | "operator" | "contributor" | "observer";
type CompletionResult = "complete" | "partial" | "incomplete" | "failed" | "cancelled";

type Actor = {
  id: string;
  displayName: string;
  kind: "human" | "agent";
  role: WorkspaceRole;
  canReview: boolean;
  canApprove: boolean;
};

type CompletionAssessment = {
  runId: string;
  result: CompletionResult;
  reason?: string;
  assessedBy: string;
  assessedAt: string;
  evidenceExceptionId?: string;
};

type EvidenceException = {
  id: string;
  runId: string;
  conclusionIds: string[];
  reason: string;
  approvedBy: string;
  createdAt: string;
};

type ReviewRecord = {
  id: string;
  conclusionId: string;
  previousState: string;
  newState: string;
  reason: string;
  sourceVersionIds: string[];
  reviewedBy: string;
  reviewedAt: string;
};

type CompletionOutcome = {
  assessment: CompletionAssessment;
  coverage: {
    validEvidence: number;
    requiredEvidence: number;
    ratio: number;
    exceptionCounted: boolean;
  };
  blockingConclusionIds: string[];
  exception?: EvidenceException;
};

type CompletionFixture = {
  workspaceId: string;
  runId: string;
  owner: Actor;
  reviewer: Actor;
  observer: Actor;
  conclusionIds: string[];
  sourceVersionIds: string[];
};

type ArchiveFixture = {
  workspaceId: string;
  workspaceName: string;
  runId: string;
  otherRunId: string;
  owner: Actor;
  reviewer: Actor;
  observer: Actor;
  conclusionId: string;
  presentArtifactIds: string[];
  missingArtifactId: string;
  truncatedArtifactId: string;
  unknownItemId: string;
};

type ArchiveArtifactEntry = {
  id: string;
  name: string;
  runId?: string;
  sha256: string;
  size: number;
  path: string;
  status: "present" | "missing" | "truncated" | "inaccessible" | "unknown";
};

type ArchiveManifest = {
  formatVersion: number;
  exportedAt: string;
  exportedBy: string;
  scope: string;
  workspace: {
    id: string;
    name: string;
    status: string;
    goal?: string;
    completionCriteria?: string;
  };
  runs: Array<{ id: string; state: string; result?: string }>;
  conclusions: Array<{
    id: string;
    body: string;
    state: string;
    scope: string;
    confirmedBy?: string;
    confirmedAt?: string;
    sources: Array<{ sourceVersionId: string; relation: string }>;
    reviews: ReviewRecord[];
  }>;
  completionAssessments: CompletionAssessment[];
  exceptions: EvidenceException[];
  artifacts: ArchiveArtifactEntry[];
  missingItems: string[];
  unknownItems: string[];
};

type ArchiveExport = {
  id: string;
  workspaceId: string;
  scope: "full_archive" | "selected_tasks" | "owned_node_receipts";
  formatVersion: number;
  manifestBlobId: string;
  missingItems: string[];
  unknownItems: string[];
  exportedBy: string;
  exportedAt: string;
};

type ArchiveHarness = {
  seed: {
    completionScenario(input: {
      evidence: "missing" | "invalid" | "review_required";
    }): Promise<CompletionFixture>;
    archiveScenario(): Promise<ArchiveFixture>;
  };
  assessCompletion(input: {
    workspaceId: string;
    runId: string;
    actor: Actor;
    result: CompletionResult;
    reason?: string;
    evidenceExceptionReason?: string;
  }): Promise<Result<CompletionOutcome>>;
  addSupportingEvidence(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
    originType: "artifact" | "context" | "external" | "member_input";
    originId: string;
    contentRef: string;
    contentDigest: string;
  }): Promise<Result<{ sourceId: string; sourceVersionId: string }>>;
  reviewConclusion(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
    newState: "confirmed" | "review_required" | "invalid";
    reason: string;
    sourceVersionIds?: string[];
  }): Promise<Result<{ review: ReviewRecord }>>;
  getCompletionState(input: { workspaceId: string; runId: string; actor: Actor }): Promise<
    Result<{
      runResult?: CompletionResult;
      assessments: CompletionAssessment[];
      exceptions: EvidenceException[];
    }>
  >;
  getReviewHistory(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
  }): Promise<Result<ReviewRecord[]>>;
  archiveWorkspace(input: {
    workspaceId: string;
    actor: Actor;
    reason?: string;
  }): Promise<Result<{ id: string; status: string }>>;
  attemptMutationAfterArchive(input: {
    workspaceId: string;
    actor: Actor;
    mutation: "conclusion" | "review" | "artifact_upload";
  }): Promise<Result<unknown>>;
  exportArchive(input: {
    workspaceId: string;
    actor: Actor;
    scope: ArchiveExport["scope"];
    runIds?: string[];
  }): Promise<Result<ArchiveExport>>;
  getArchiveManifest(input: {
    workspaceId: string;
    exportId: string;
    actor: Actor;
  }): Promise<Result<{ mediaType: string; bytes: Uint8Array; manifest: ArchiveManifest }>>;
  getArtifactBytes(input: {
    workspaceId: string;
    artifactId: string;
    actor: Actor;
  }): Promise<Result<{ bytes: Uint8Array; sha256: string; size: number; truncated: boolean }>>;
  getExportAudit(input: { workspaceId: string; actor: Actor }): Promise<Result<ArchiveExport[]>>;
  close(): Promise<void>;
};

const HARNESS_MODULE = "../../../packages/test-support/src/index.ts";

function missingUs5Harness(cause?: unknown): Error {
  const causeText = cause instanceof Error ? cause.message : String(cause ?? "");
  return new Error(
    [
      "US5 completion-gate/archive implementation is missing.",
      `Expected ${HARNESS_MODULE} to export createUs5Harness() backed by the real evidence and archive services.`,
      "Required by T152/T165-T167: completion assessment, evidence coverage, owner exceptions,",
      "read-only archiving, manifest export, artifact correspondence, and missing/unknown markers.",
      causeText ? `Load/invoke failure: ${causeText}` : "The harness export was not found.",
    ].join(" "),
  );
}

async function createHarness(): Promise<ArchiveHarness> {
  let module: Record<string, unknown>;
  try {
    module = (await import(HARNESS_MODULE)) as Record<string, unknown>;
  } catch (cause) {
    throw missingUs5Harness(cause);
  }

  const factory = module.createUs5Harness;
  if (typeof factory !== "function") {
    throw missingUs5Harness();
  }

  try {
    return (await factory()) as ArchiveHarness;
  } catch (cause) {
    throw missingUs5Harness(cause);
  }
}

let harness: ArchiveHarness | undefined;

before(async () => {
  harness = await createHarness();
});

after(async () => {
  await harness?.close();
});

function requireHarness(): ArchiveHarness {
  assert.ok(harness, "US5 archive harness was not initialised");
  return harness;
}

function expectOk<T>(result: Result<T>, context: string): T {
  if (!result.ok) {
    assert.fail(
      `${context}: expected success, received ${result.error.status} ${result.error.code}` +
        (result.error.detail ? ` (${result.error.detail})` : ""),
    );
  }
  return result.value;
}

function expectError(
  result: Result<unknown>,
  status: number,
  code: string,
  context: string,
): Us5Error {
  assert.equal(result.ok, false, `${context}: expected ${status} ${code}, received success`);
  if (result.ok) {
    assert.fail(`${context}: expected ${status} ${code}, received success`);
  }
  assert.equal(result.error.status, status, `${context}: unexpected HTTP status`);
  assert.equal(result.error.code, code, `${context}: unexpected problem code`);
  return result.error;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertRfc3339(value: string, label: string): void {
  assert.ok(
    !Number.isNaN(Date.parse(value)),
    `${label} must be an RFC 3339 timestamp, got ${value}`,
  );
}

describe("US5 completion gate and archive export", () => {
  test("Missing, invalid, and review-required evidence block an unreported complete result", async () => {
    const subject = requireHarness();

    for (const evidence of ["missing", "invalid", "review_required"] as const) {
      const fixture = expectOk(
        await subject.seed.completionScenario({ evidence }),
        `seed completion scenario (${evidence})`,
      );

      const blocked = await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.reviewer,
        result: "complete",
        reason: "Everything looks done.",
      });
      expectError(blocked, 422, "evidence_incomplete", `complete with ${evidence} evidence`);

      const state = expectOk(
        await subject.getCompletionState({
          workspaceId: fixture.workspaceId,
          runId: fixture.runId,
          actor: fixture.reviewer,
        }),
        `read completion state (${evidence})`,
      );
      assert.deepEqual(
        state.assessments,
        [],
        "A blocked completion must not persist a completion assessment",
      );
      assert.equal(
        state.runResult,
        undefined,
        "The run result must not be changed by a blocked attempt",
      );
    }
  });

  test("Supplementing evidence and re-reviewing allows an honest complete result", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.completionScenario({ evidence: "missing" }),
      "seed missing-evidence scenario",
    );

    expectError(
      await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.reviewer,
        result: "complete",
      }),
      422,
      "evidence_incomplete",
      "complete before supplementing evidence",
    );

    const evidence = expectOk(
      await subject.addSupportingEvidence({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionIds[0],
        actor: fixture.reviewer,
        originType: "artifact",
        originId: "artifact:completion-report",
        contentRef: "object://workspace/completion-report",
        contentDigest: `sha256:${"c".repeat(64)}`,
      }),
      "add missing evidence",
    );

    expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionIds[0],
        actor: fixture.reviewer,
        newState: "confirmed",
        reason: "The newly attached report supports the completion criterion.",
        sourceVersionIds: [evidence.sourceVersionId],
      }),
      "confirm with supplemented evidence",
    );

    const outcome = expectOk(
      await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.reviewer,
        result: "complete",
        reason: "Evidence gap was supplemented and reviewed.",
      }),
      "complete after supplementing evidence",
    );

    assert.equal(outcome.assessment.result, "complete");
    assert.equal(outcome.assessment.evidenceExceptionId, undefined);
    assert.deepEqual(outcome.blockingConclusionIds, []);
    assert.ok(
      outcome.coverage.ratio >= 1,
      "Supplemented and reviewed evidence must count as valid coverage",
    );
    assert.equal(outcome.coverage.exceptionCounted, false);
  });

  test("Partial completion is allowed and keeps the remaining evidence risk visible", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.completionScenario({ evidence: "missing" }),
      "seed missing-evidence scenario",
    );

    const outcome = expectOk(
      await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.reviewer,
        result: "partial",
        reason: "The main result is usable, but one supporting source is still missing.",
      }),
      "record partial completion",
    );

    assert.equal(outcome.assessment.result, "partial");
    assert.equal(outcome.assessment.evidenceExceptionId, undefined);
    assert.ok(
      outcome.blockingConclusionIds.length > 0,
      "Partial completion must preserve the evidence gap",
    );
    assert.ok(outcome.coverage.ratio < 1, "Partial completion must not claim full valid coverage");
    assert.equal(outcome.coverage.exceptionCounted, false);

    const state = expectOk(
      await subject.getCompletionState({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.reviewer,
      }),
      "read partial completion state",
    );
    assert.equal(state.runResult, "partial");
    assert.equal(state.assessments.length, 1);
  });

  test("An owner exception requires a reason, keeps the risk, and never clears review history", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.completionScenario({ evidence: "missing" }),
      "seed missing-evidence scenario",
    );

    const priorReview = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionIds[0],
        actor: fixture.reviewer,
        newState: "review_required",
        reason: "The source could not be found.",
      }),
      "record review_required before exception",
    );
    const historyBefore = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionIds[0],
        actor: fixture.reviewer,
      }),
      "read history before exception",
    );
    assert.equal(historyBefore.length, 1);

    expectError(
      await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.reviewer,
        result: "complete",
        evidenceExceptionReason: "Reviewer is not the owner.",
      }),
      403,
      "permission_denied",
      "non-owner evidence exception",
    );

    expectError(
      await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.owner,
        result: "complete",
        evidenceExceptionReason: "",
      }),
      400,
      "invalid_request",
      "blank evidence exception reason",
    );

    const outcome = expectOk(
      await subject.assessCompletion({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        actor: fixture.owner,
        result: "complete",
        evidenceExceptionReason:
          "Accepted with a documented residual risk; the source remains missing.",
      }),
      "owner records exception",
    );

    assert.equal(outcome.assessment.result, "complete");
    assert.ok(outcome.assessment.evidenceExceptionId, "The assessment must link the exception");
    assert.ok(outcome.exception, "The evidence exception must be returned with attribution");
    assert.equal(outcome.exception.approvedBy, fixture.owner.id);
    assert.equal(
      outcome.exception.reason,
      "Accepted with a documented residual risk; the source remains missing.",
    );
    assert.deepEqual(outcome.exception.conclusionIds, [fixture.conclusionIds[0]]);
    assertRfc3339(outcome.exception.createdAt, "EvidenceException.createdAt");
    assert.equal(
      outcome.coverage.exceptionCounted,
      false,
      "An exception must not be counted as valid evidence coverage",
    );
    assert.ok(
      outcome.blockingConclusionIds.includes(fixture.conclusionIds[0]),
      "The exception must not hide the missing evidence",
    );

    const historyAfter = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionIds[0],
        actor: fixture.reviewer,
      }),
      "read history after exception",
    );
    assert.deepEqual(
      historyAfter,
      historyBefore,
      "An owner exception must not delete or rewrite review history",
    );
    assert.deepEqual(historyAfter[0], priorReview.review);
  });

  test("Archiving makes the workspace read-only while preserving read and export access", async () => {
    const subject = requireHarness();
    const fixture = expectOk(await subject.seed.archiveScenario(), "seed archive scenario");

    const archived = expectOk(
      await subject.archiveWorkspace({
        workspaceId: fixture.workspaceId,
        actor: fixture.owner,
        reason: "The task is complete and ready to preserve.",
      }),
      "archive workspace",
    );
    assert.equal(archived.status, "archived");

    for (const mutation of ["conclusion", "review", "artifact_upload"] as const) {
      expectError(
        await subject.attemptMutationAfterArchive({
          workspaceId: fixture.workspaceId,
          actor: fixture.owner,
          mutation,
        }),
        409,
        "workspace_archived",
        `mutate archived workspace (${mutation})`,
      );
    }

    const exported = expectOk(
      await subject.exportArchive({
        workspaceId: fixture.workspaceId,
        actor: fixture.reviewer,
        scope: "full_archive",
      }),
      "export an archived workspace",
    );
    assert.equal(exported.scope, "full_archive");
  });

  test("Exported manifest is independently readable and maps every artifact byte to a manifest entry", async () => {
    const subject = requireHarness();
    const fixture = expectOk(await subject.seed.archiveScenario(), "seed archive scenario");

    const exported = expectOk(
      await subject.exportArchive({
        workspaceId: fixture.workspaceId,
        actor: fixture.reviewer,
        scope: "full_archive",
      }),
      "export full archive",
    );

    assert.ok(exported.id);
    assert.equal(exported.workspaceId, fixture.workspaceId);
    assert.equal(exported.formatVersion, 1);
    assert.equal(exported.scope, "full_archive");
    assert.equal(exported.exportedBy, fixture.reviewer.id);
    assertRfc3339(exported.exportedAt, "ArchiveExport.exportedAt");
    assert.ok(
      exported.manifestBlobId,
      "ArchiveExport.manifestBlobId must identify the manifest object",
    );

    const archive = expectOk(
      await subject.getArchiveManifest({
        workspaceId: fixture.workspaceId,
        exportId: exported.id,
        actor: fixture.reviewer,
      }),
      "read archive manifest",
    );

    assert.match(
      archive.mediaType,
      /^application\/json\b/,
      "Manifest must be readable as generic JSON",
    );
    const raw = new TextDecoder().decode(archive.bytes);
    const parsed = JSON.parse(raw) as ArchiveManifest;
    assert.deepEqual(
      parsed,
      archive.manifest,
      "The raw bytes must be the same manifest offered to the reader",
    );

    assert.equal(parsed.formatVersion, 1);
    assert.equal(parsed.workspace.id, fixture.workspaceId);
    assert.equal(parsed.workspace.status, "archived");
    assert.equal(parsed.exportedBy, fixture.reviewer.id);
    assertRfc3339(parsed.exportedAt, "ArchiveManifest.exportedAt");
    assert.equal(parsed.scope, "full_archive");

    const exportedArtifactIds = new Set(parsed.artifacts.map((artifact) => artifact.id));
    for (const artifactId of fixture.presentArtifactIds) {
      assert.ok(
        exportedArtifactIds.has(artifactId),
        `Manifest is missing present artifact ${artifactId}`,
      );
    }

    for (const entry of parsed.artifacts.filter((artifact) => artifact.status === "present")) {
      const download = expectOk(
        await subject.getArtifactBytes({
          workspaceId: fixture.workspaceId,
          artifactId: entry.id,
          actor: fixture.reviewer,
        }),
        `download manifest artifact ${entry.id}`,
      );
      assert.equal(download.size, entry.size, `Manifest size mismatch for ${entry.id}`);
      assert.equal(download.sha256, entry.sha256, `Manifest digest mismatch for ${entry.id}`);
      assert.equal(
        sha256(download.bytes),
        entry.sha256,
        `Downloaded bytes do not match ${entry.id}`,
      );
      assert.equal(download.truncated, false);
      assert.ok(
        entry.path.length > 0,
        "Each manifest artifact needs a path a generic reader can open",
      );
    }

    assert.ok(parsed.conclusions.some((conclusion) => conclusion.id === fixture.conclusionId));
    assert.ok(parsed.runs.some((run) => run.id === fixture.runId));
  });

  test("Missing, truncated, inaccessible, and unknown items are explicitly marked, not omitted", async () => {
    const subject = requireHarness();
    const fixture = expectOk(await subject.seed.archiveScenario(), "seed archive scenario");

    const exported = expectOk(
      await subject.exportArchive({
        workspaceId: fixture.workspaceId,
        actor: fixture.reviewer,
        scope: "full_archive",
      }),
      "export archive with gaps",
    );

    assert.ok(
      exported.missingItems.includes(fixture.missingArtifactId),
      "ArchiveExport.missingItems must include the missing artifact",
    );
    assert.ok(
      exported.unknownItems.includes(fixture.unknownItemId),
      "ArchiveExport.unknownItems must include the unknown item",
    );

    const archive = expectOk(
      await subject.getArchiveManifest({
        workspaceId: fixture.workspaceId,
        exportId: exported.id,
        actor: fixture.reviewer,
      }),
      "read archive manifest with gaps",
    );
    const manifest = archive.manifest;

    assert.ok(manifest.missingItems.includes(fixture.missingArtifactId));
    assert.ok(manifest.unknownItems.includes(fixture.unknownItemId));

    const missing = manifest.artifacts.find(
      (artifact) => artifact.id === fixture.missingArtifactId,
    );
    assert.ok(missing, "A missing artifact must still have a manifest entry");
    assert.equal(missing.status, "missing");

    const truncated = manifest.artifacts.find(
      (artifact) => artifact.id === fixture.truncatedArtifactId,
    );
    assert.ok(truncated, "A truncated artifact must still have a manifest entry");
    assert.equal(truncated.status, "truncated");

    const missingDownload = await subject.getArtifactBytes({
      workspaceId: fixture.workspaceId,
      artifactId: fixture.missingArtifactId,
      actor: fixture.reviewer,
    });
    assert.equal(
      missingDownload.ok,
      false,
      "A missing artifact must not be silently replaced by empty bytes",
    );

    const truncatedDownload = expectOk(
      await subject.getArtifactBytes({
        workspaceId: fixture.workspaceId,
        artifactId: fixture.truncatedArtifactId,
        actor: fixture.reviewer,
      }),
      "download truncated artifact",
    );
    assert.equal(truncatedDownload.truncated, true, "Truncation must be reported to the reader");

    assert.equal(
      manifest.artifacts.length,
      fixture.presentArtifactIds.length + 2,
      "The manifest must keep one entry for each known artifact, including gaps",
    );
  });

  test("Selected-task export honors the requested run scope and records the export", async () => {
    const subject = requireHarness();
    const fixture = expectOk(await subject.seed.archiveScenario(), "seed archive scenario");

    const first = expectOk(
      await subject.exportArchive({
        workspaceId: fixture.workspaceId,
        actor: fixture.reviewer,
        scope: "selected_tasks",
        runIds: [fixture.runId],
      }),
      "export selected run",
    );
    const second = expectOk(
      await subject.exportArchive({
        workspaceId: fixture.workspaceId,
        actor: fixture.owner,
        scope: "full_archive",
      }),
      "export full archive afterwards",
    );
    assert.notEqual(first.id, second.id, "Every export must have its own record");

    const selected = expectOk(
      await subject.getArchiveManifest({
        workspaceId: fixture.workspaceId,
        exportId: first.id,
        actor: fixture.reviewer,
      }),
      "read selected-task manifest",
    );
    assert.equal(selected.manifest.scope, "selected_tasks");
    assert.deepEqual(
      new Set(selected.manifest.runs.map((run) => run.id)),
      new Set([fixture.runId]),
    );
    assert.ok(
      selected.manifest.artifacts.every(
        (artifact) => artifact.runId === undefined || artifact.runId === fixture.runId,
      ),
      "Selected-task export must not include artifacts from another run",
    );
    assert.ok(
      selected.manifest.conclusions.some((conclusion) => conclusion.id === fixture.conclusionId),
      "Selected-task export must include the conclusions needed to understand the result",
    );

    const audit = expectOk(
      await subject.getExportAudit({ workspaceId: fixture.workspaceId, actor: fixture.reviewer }),
      "read export audit",
    );
    assert.equal(audit.length, 2, "Both exports must remain in the audit history");
    assert.deepEqual(audit[0], first, "Earlier export records must not be rewritten");
    assert.deepEqual(audit[1], second);
    assert.equal(audit[0].exportedBy, fixture.reviewer.id);
    assert.equal(audit[1].exportedBy, fixture.owner.id);
  });
});
