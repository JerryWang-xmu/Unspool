import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

/**
 * US5 source-change impact tests.
 *
 * Covered acceptance scenarios:
 * - spec US5.2 / UAT-20 / TO-06: one shared source supports several conclusions,
 *   a completion criterion, an artifact, and a pending action. Updating,
 *   superseding, revoking, or invalidating it marks every direct dependent for
 *   review, without reversing decisions, deleting artifacts, or revoking
 *   external actions.
 * - spec US5.3 / UAT-21: conflicting sources are shown side by side with their
 *   own origin and last-confirmation time; the system never selects a winner.
 * - spec edge case: one notification per changed source, but one visible impact
 *   per dependent; re-review appends history and keeps invalidation history.
 * - QS-05 expectation: a due source becomes review_required, not invalid, and an
 *   external source without monitoring is shown as not monitored.
 */

type Us5Error = {
  status: number;
  code: string;
  detail?: string;
  revision?: number;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: Us5Error };

type WorkspaceRole = "owner" | "operator" | "contributor" | "observer";
type ConclusionKind = "fact" | "assumption" | "decision";
type ConclusionState = "unverified" | "confirmed" | "review_required" | "invalid";
type SourceState =
  | "active"
  | "review_required"
  | "superseded"
  | "revoked"
  | "invalid"
  | "unavailable";
type ImpactTargetType = "conclusion" | "completion_criterion" | "artifact" | "pending_action";
type ImpactState = "review_required" | "resolved";
type EvidenceRelation = "supports" | "conflicts" | "context";

type Actor = {
  id: string;
  displayName: string;
  kind: "human" | "agent";
  role: WorkspaceRole;
  canReview: boolean;
  canApprove: boolean;
};

type EvidenceSource = {
  id: string;
  workspaceId: string;
  originType: "artifact" | "context" | "external" | "member_input";
  originId: string;
  currentVersionId: string;
  state: SourceState;
  lastConfirmedAt: string;
  reviewDueAt?: string;
  externalMonitoring: boolean;
};

type SourceVersion = {
  id: string;
  sourceId: string;
  version: number;
  contentRef: string;
  contentDigest: string;
  recordedAt: string;
  supersedesId?: string;
};

type ConclusionImpact = {
  id: string;
  conclusionId: string;
  targetType: ImpactTargetType;
  targetId: string;
  impactKind: string;
  state: ImpactState;
};

type ReviewRecord = {
  id: string;
  conclusionId: string;
  previousState: ConclusionState;
  newState: ConclusionState;
  reason: string;
  sourceVersionIds: string[];
  reviewedBy: string;
  reviewedAt: string;
};

type VisibleSource = {
  sourceId: string;
  sourceVersionId: string;
  relation: EvidenceRelation;
  state: SourceState;
  originType: string;
  originId: string;
  contentDigest: string;
  lastConfirmedAt: string;
  externalMonitoring: boolean;
};

type ImpactView = {
  conclusions: Array<{
    id: string;
    body: string;
    kind: ConclusionKind;
    state: ConclusionState;
    reviewRequired: boolean;
    sources: VisibleSource[];
    impacts: ConclusionImpact[];
  }>;
  impacts: ConclusionImpact[];
  conflictGroups: Array<{
    conclusionId: string;
    sources: Array<{
      sourceId: string;
      sourceVersionId: string;
      contentDigest: string;
      lastConfirmedAt: string;
    }>;
    resolved: boolean;
    selectedSourceVersionId?: string;
  }>;
  notificationCountBySource: Record<string, number>;
  externalVerification: "monitored" | "not_monitored" | "unknown";
};

type SharedImpactFixture = {
  workspaceId: string;
  runId: string;
  owner: Actor;
  reviewer: Actor;
  observer: Actor;
  sourceId: string;
  sourceVersionId: string;
  conclusionIds: [string, string];
  completionCriterionId: string;
  artifactId: string;
  pendingActionId: string;
};

type ConflictFixture = {
  workspaceId: string;
  conclusionId: string;
  conclusionBody: string;
  sourceIds: [string, string];
  sourceVersionIds: [string, string];
  reviewer: Actor;
};

type ExpiryFixture = {
  workspaceId: string;
  sourceId: string;
  sourceVersionId: string;
  conclusionId: string;
  conclusionBody: string;
  reviewDueAt: string;
  lastConfirmedAt: string;
  reviewer: Actor;
};

type SourceChangeResult = {
  source: EvidenceSource;
  impacts: ConclusionImpact[];
  affectedConclusionIds: string[];
  notificationCount: number;
};

type ImpactHarness = {
  seed: {
    sharedSourceImpact(): Promise<SharedImpactFixture>;
    conflictingSources(): Promise<ConflictFixture>;
    expiringExternalSource(): Promise<ExpiryFixture>;
  };
  recordSourceVersion(input: {
    workspaceId: string;
    sourceId: string;
    actor: Actor;
    contentRef: string;
    contentDigest: string;
    recordedAt?: string;
    supersedesId?: string;
  }): Promise<
    Result<{ source: EvidenceSource; version: SourceVersion; impacts: ConclusionImpact[] }>
  >;
  changeSourceState(input: {
    workspaceId: string;
    sourceId: string;
    actor: Actor;
    state: Exclude<SourceState, "active" | "review_required">;
    reason?: string;
  }): Promise<Result<SourceChangeResult>>;
  getSourceVersion(input: {
    workspaceId: string;
    sourceVersionId: string;
    actor: Actor;
  }): Promise<Result<SourceVersion>>;
  getImpactView(input: { workspaceId: string; actor: Actor }): Promise<Result<ImpactView>>;
  evaluateDueSources(input: {
    workspaceId: string;
    now: string;
    actor: Actor;
  }): Promise<Result<{ affectedConclusionIds: string[]; notificationCount: number }>>;
  reviewConclusion(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
    newState: "confirmed" | "review_required" | "invalid";
    reason: string;
    sourceVersionIds?: string[];
  }): Promise<Result<{ review: ReviewRecord }>>;
  getReviewHistory(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
  }): Promise<Result<ReviewRecord[]>>;
  inspectArtifact(input: {
    workspaceId: string;
    artifactId: string;
    actor: Actor;
  }): Promise<
    Result<{ id: string; sha256: string; size: number; exists: boolean; deleted: boolean }>
  >;
  inspectPendingAction(input: {
    workspaceId: string;
    actionId: string;
    actor: Actor;
  }): Promise<Result<{ id: string; state: string; revoked: boolean; executed: boolean }>>;
  close(): Promise<void>;
};

const HARNESS_MODULE = "../../../packages/test-support/src/index.ts";

function missingUs5Harness(cause?: unknown): Error {
  const causeText = cause instanceof Error ? cause.message : String(cause ?? "");
  return new Error(
    [
      "US5 source-impact implementation is missing.",
      `Expected ${HARNESS_MODULE} to export createUs5Harness() backed by the real evidence services.`,
      "Required by T151/T162-T165: immutable source versions, direct-dependency impact traversal,",
      "single-source notification, review-due evaluation, conflict presentation, and re-review.",
      causeText ? `Load/invoke failure: ${causeText}` : "The harness export was not found.",
    ].join(" "),
  );
}

async function createHarness(): Promise<ImpactHarness> {
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
    return (await factory()) as ImpactHarness;
  } catch (cause) {
    throw missingUs5Harness(cause);
  }
}

let harness: ImpactHarness | undefined;

before(async () => {
  harness = await createHarness();
});

after(async () => {
  await harness?.close();
});

function requireHarness(): ImpactHarness {
  assert.ok(harness, "US5 impact harness was not initialised");
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

function sourceFor(view: ImpactView, sourceId: string): VisibleSource {
  for (const conclusion of view.conclusions) {
    const source = conclusion.sources.find((candidate) => candidate.sourceId === sourceId);
    if (source) {
      return source;
    }
  }
  assert.fail(`Impact view did not expose source ${sourceId}`);
}

function conclusionById(view: ImpactView, conclusionId: string) {
  const conclusion = view.conclusions.find((candidate) => candidate.id === conclusionId);
  assert.ok(conclusion, `Impact view did not expose conclusion ${conclusionId}`);
  return conclusion;
}

describe("US5 source-change impact", () => {
  test("Revoking one shared source marks every direct dependent for review without reversing effects", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.sharedSourceImpact(),
      "seed shared-source impact scenario",
    );

    const artifactBefore = expectOk(
      await subject.inspectArtifact({
        workspaceId: fixture.workspaceId,
        artifactId: fixture.artifactId,
        actor: fixture.reviewer,
      }),
      "inspect artifact before source change",
    );
    const actionBefore = expectOk(
      await subject.inspectPendingAction({
        workspaceId: fixture.workspaceId,
        actionId: fixture.pendingActionId,
        actor: fixture.reviewer,
      }),
      "inspect pending action before source change",
    );

    const change = expectOk(
      await subject.changeSourceState({
        workspaceId: fixture.workspaceId,
        sourceId: fixture.sourceId,
        actor: fixture.reviewer,
        state: "revoked",
        reason: "The source owner revoked the shared statement.",
      }),
      "revoke shared source",
    );

    assert.equal(change.source.state, "revoked");
    assert.deepEqual(
      new Set(change.affectedConclusionIds),
      new Set(fixture.conclusionIds),
      "Every directly supporting conclusion must be reported",
    );
    assert.equal(change.notificationCount, 1, "One changed source must produce one notification");

    const targetTypes = new Set(change.impacts.map((impact) => impact.targetType));
    assert.deepEqual(
      targetTypes,
      new Set<ImpactTargetType>([
        "conclusion",
        "completion_criterion",
        "artifact",
        "pending_action",
      ]),
      "The impact list must cover conclusions, completion criteria, artifacts, and pending actions",
    );
    assert.ok(
      change.impacts.every((impact) => impact.state === "review_required"),
      "Direct impacts must be marked review_required",
    );

    const view = expectOk(
      await subject.getImpactView({ workspaceId: fixture.workspaceId, actor: fixture.reviewer }),
      "read impact view",
    );
    for (const conclusionId of fixture.conclusionIds) {
      const conclusion = conclusionById(view, conclusionId);
      assert.equal(conclusion.state, "review_required");
      assert.equal(conclusion.reviewRequired, true);
    }
    assert.equal(view.notificationCountBySource[fixture.sourceId], 1);

    const artifactAfter = expectOk(
      await subject.inspectArtifact({
        workspaceId: fixture.workspaceId,
        artifactId: fixture.artifactId,
        actor: fixture.reviewer,
      }),
      "inspect artifact after source change",
    );
    assert.equal(artifactAfter.exists, true, "A source change must not delete the artifact");
    assert.equal(artifactAfter.deleted, false);
    assert.equal(
      artifactAfter.sha256,
      artifactBefore.sha256,
      "Artifact bytes must remain unchanged",
    );
    assert.equal(artifactAfter.size, artifactBefore.size);

    const actionAfter = expectOk(
      await subject.inspectPendingAction({
        workspaceId: fixture.workspaceId,
        actionId: fixture.pendingActionId,
        actor: fixture.reviewer,
      }),
      "inspect pending action after source change",
    );
    assert.equal(actionAfter.revoked, false, "A source change must not revoke an external action");
    assert.equal(actionAfter.executed, actionBefore.executed);
    assert.equal(
      actionAfter.state,
      actionBefore.state,
      "A pending action is flagged, not reversed",
    );
  });

  test("Superseding a source creates an immutable new version and reopens every dependent", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.sharedSourceImpact(),
      "seed shared-source impact scenario",
    );

    const previous = expectOk(
      await subject.getSourceVersion({
        workspaceId: fixture.workspaceId,
        sourceVersionId: fixture.sourceVersionId,
        actor: fixture.reviewer,
      }),
      "read original source version",
    );

    const updatedDigest = `sha256:${"b".repeat(64)}`;
    const update = expectOk(
      await subject.recordSourceVersion({
        workspaceId: fixture.workspaceId,
        sourceId: fixture.sourceId,
        actor: fixture.reviewer,
        contentRef: "object://workspace/source/v2",
        contentDigest: updatedDigest,
        supersedesId: fixture.sourceVersionId,
      }),
      "record superseding source version",
    );

    assert.equal(update.version.version, previous.version + 1);
    assert.equal(update.version.supersedesId, fixture.sourceVersionId);
    assert.equal(update.version.contentDigest, updatedDigest);
    assert.equal(update.source.currentVersionId, update.version.id);
    assert.equal(update.source.state, "review_required");

    const unchanged = expectOk(
      await subject.getSourceVersion({
        workspaceId: fixture.workspaceId,
        sourceVersionId: fixture.sourceVersionId,
        actor: fixture.reviewer,
      }),
      "re-read original source version",
    );
    assert.deepEqual(unchanged, previous, "An existing SourceVersion must never be rewritten");
    assert.ok(update.impacts.length > 0, "The new version must expose affected dependents");
    assert.ok(
      update.impacts.some((impact) => impact.targetType === "completion_criterion"),
      "A completion criterion linked to the source must enter review",
    );
  });

  test("Conflicting sources are presented side by side and never auto-selected", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.conflictingSources(),
      "seed conflicting-sources scenario",
    );

    const view = expectOk(
      await subject.getImpactView({ workspaceId: fixture.workspaceId, actor: fixture.reviewer }),
      "read conflict view",
    );

    const conclusion = conclusionById(view, fixture.conclusionId);
    assert.equal(conclusion.state, "review_required");
    assert.equal(conclusion.reviewRequired, true);

    const group = view.conflictGroups.find(
      (candidate) => candidate.conclusionId === fixture.conclusionId,
    );
    assert.ok(group, "The conflicting evidence must be grouped for the conclusion");
    assert.equal(group.sources.length, 2, "Both conflicting sources must be shown");
    assert.deepEqual(
      new Set(group.sources.map((source) => source.sourceVersionId)),
      new Set(fixture.sourceVersionIds),
    );
    assert.equal(group.resolved, false, "The system must not resolve a conflict by itself");
    assert.equal(
      group.selectedSourceVersionId,
      undefined,
      "No source may be marked as selected before a human review",
    );

    for (const source of group.sources) {
      assert.equal(typeof source.sourceId, "string");
      assert.match(source.contentDigest, /^sha256:[0-9a-f]{64}$/);
      assert.ok(!Number.isNaN(Date.parse(source.lastConfirmedAt)));
    }
  });

  test("A due source enters review_required rather than invalid and keeps its last confirmation", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.expiringExternalSource(),
      "seed expiring external source",
    );

    const evaluated = expectOk(
      await subject.evaluateDueSources({
        workspaceId: fixture.workspaceId,
        now: new Date(Date.parse(fixture.reviewDueAt) + 60_000).toISOString(),
        actor: fixture.reviewer,
      }),
      "evaluate review due date",
    );
    assert.ok(evaluated.affectedConclusionIds.includes(fixture.conclusionId));
    assert.equal(evaluated.notificationCount, 1);

    const view = expectOk(
      await subject.getImpactView({ workspaceId: fixture.workspaceId, actor: fixture.reviewer }),
      "read view after due date",
    );
    const conclusion = conclusionById(view, fixture.conclusionId);
    assert.equal(
      conclusion.state,
      "review_required",
      "Expiry requests review; it must not silently invalidate the conclusion",
    );

    const source = sourceFor(view, fixture.sourceId);
    assert.equal(source.state, "review_required");
    assert.equal(
      source.lastConfirmedAt,
      fixture.lastConfirmedAt,
      "Expiry must not pretend the source was newly confirmed",
    );
  });

  test("External sources without monitoring remain unknown and expose the last confirmation time", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.expiringExternalSource(),
      "seed unmonitored external source",
    );

    const view = expectOk(
      await subject.getImpactView({ workspaceId: fixture.workspaceId, actor: fixture.reviewer }),
      "read external-source view",
    );

    assert.equal(view.externalVerification, "not_monitored");
    const source = sourceFor(view, fixture.sourceId);
    assert.equal(source.externalMonitoring, false);
    assert.equal(source.lastConfirmedAt, fixture.lastConfirmedAt);
    assert.equal(
      source.externalMonitoring === false,
      true,
      "The view must not claim real-time verification for an unmonitored source",
    );
  });

  test("Re-confirmation appends history and preserves the earlier invalidation records", async () => {
    const subject = requireHarness();
    const fixture = expectOk(await subject.seed.conflictingSources(), "seed confirmation scenario");

    const invalidated = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionId,
        actor: fixture.reviewer,
        newState: "invalid",
        reason: "The two sources contradict each other.",
      }),
      "invalidate conflicting conclusion",
    );

    const reconfirmed = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionId,
        actor: fixture.reviewer,
        newState: "confirmed",
        reason: "Reviewed both sources; the scope now uses the newer one explicitly.",
        sourceVersionIds: [fixture.sourceVersionIds[1]],
      }),
      "reconfirm after manual conflict review",
    );

    assert.equal(reconfirmed.review.previousState, "invalid");
    assert.equal(reconfirmed.review.newState, "confirmed");
    assert.deepEqual(reconfirmed.review.sourceVersionIds, [fixture.sourceVersionIds[1]]);

    const history = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: fixture.conclusionId,
        actor: fixture.reviewer,
      }),
      "read re-review history",
    );
    assert.equal(history.length, 2);
    assert.deepEqual(history[0], invalidated.review);
    assert.deepEqual(history[1], reconfirmed.review);
    assert.ok(history.some((record) => record.newState === "invalid"));
  });

  test("One source change yields one notification while each affected object stays separately visible", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.sharedSourceImpact(),
      "seed shared-source impact scenario",
    );

    const change = expectOk(
      await subject.changeSourceState({
        workspaceId: fixture.workspaceId,
        sourceId: fixture.sourceId,
        actor: fixture.reviewer,
        state: "invalid",
        reason: "The source content is no longer trustworthy.",
      }),
      "invalidate shared source",
    );

    assert.equal(change.notificationCount, 1);
    const targetIds = new Set(
      change.impacts.map((impact) => `${impact.targetType}:${impact.targetId}`),
    );
    assert.ok(targetIds.size > 1, "Separate impacted objects must remain visible individually");
    assert.equal(
      new Set(change.affectedConclusionIds).size,
      fixture.conclusionIds.length,
      "Each conclusion must be reported separately",
    );

    const view = expectOk(
      await subject.getImpactView({ workspaceId: fixture.workspaceId, actor: fixture.reviewer }),
      "read impact view after notification",
    );
    assert.equal(view.notificationCountBySource[fixture.sourceId], 1);
  });
});
