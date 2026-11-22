import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

/**
 * US5 contract tests: conclusion confirmation, source state, review history, and
 * evidence exceptions.
 *
 * Covered acceptance scenarios:
 * - spec US5.1: only an authorized human review can confirm a conclusion; a
 *   proposed conclusion stays unverified and model confidence is not a decision.
 * - spec US5.4 / UAT-19: an evidence exception is an owner decision, carries a
 *   reason, and never erases missing-evidence or review history.
 * - spec edge case: re-review is append-only and keeps prior invalid/review
 *   states.
 *
 * The tests intentionally target the planned production services through the
 * test-support seam declared below. Until T154-T167 and the US5 fixture exist,
 * this file fails with an explicit missing-behaviour message instead of passing
 * against a fake implementation.
 */

type Us5Error = {
  status: number;
  code: string;
  detail?: string;
  revision?: number;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: Us5Error };

type ActorKind = "human" | "agent";
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

type Actor = {
  id: string;
  displayName: string;
  kind: ActorKind;
  role: WorkspaceRole;
  canReview: boolean;
  canApprove: boolean;
};

type Conclusion = {
  id: string;
  workspaceId: string;
  kind: ConclusionKind;
  body: string;
  state: ConclusionState;
  scope: string;
  proposedBy: string;
  confirmedBy?: string;
  confirmedAt?: string;
  currentVersion: number;
  lastReviewedAt?: string;
  sourceVersionIds: string[];
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

type EvidenceException = {
  id: string;
  runId: string;
  conclusionIds: string[];
  reason: string;
  approvedBy: string;
  createdAt: string;
};

type SharedSourceFixture = {
  workspaceId: string;
  runId: string;
  owner: Actor;
  reviewer: Actor;
  observer: Actor;
  agent: Actor;
  sourceId: string;
  sourceVersionId: string;
  conclusionId: string;
};

type EvidenceContractHarness = {
  seed: {
    workspaceWithSharedSource(): Promise<SharedSourceFixture>;
  };
  proposeConclusion(input: {
    workspaceId: string;
    actor: Actor;
    kind: ConclusionKind;
    body: string;
    scope: string;
    sourceVersionIds: string[];
  }): Promise<Result<Conclusion>>;
  reviewConclusion(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
    newState: "confirmed" | "review_required" | "invalid";
    reason: string;
    sourceVersionIds?: string[];
  }): Promise<Result<{ conclusion: Conclusion; review: ReviewRecord }>>;
  changeSourceState(input: {
    workspaceId: string;
    sourceId: string;
    actor: Actor;
    state: Exclude<SourceState, "active" | "review_required">;
    reason?: string;
  }): Promise<Result<{ source: EvidenceSource }>>;
  recordEvidenceException(input: {
    workspaceId: string;
    runId: string;
    conclusionIds: string[];
    actor: Actor;
    reason: string;
  }): Promise<Result<EvidenceException>>;
  getReviewHistory(input: {
    workspaceId: string;
    conclusionId: string;
    actor: Actor;
  }): Promise<Result<ReviewRecord[]>>;
  close(): Promise<void>;
};

const HARNESS_MODULE = "../../../packages/test-support/src/index.ts";

function missingUs5Harness(cause?: unknown): Error {
  const causeText = cause instanceof Error ? cause.message : String(cause ?? "");
  return new Error(
    [
      "US5 evidence implementation is missing.",
      `Expected ${HARNESS_MODULE} to export createUs5Harness() backed by the real evidence services.`,
      "Required by T150/T162-T167: conclusion proposal/confirmation, source state changes,",
      "append-only review records, and owner evidence exceptions with reason and attribution.",
      causeText ? `Load/invoke failure: ${causeText}` : "The harness export was not found.",
    ].join(" "),
  );
}

async function createHarness(): Promise<EvidenceContractHarness> {
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
    return (await factory()) as EvidenceContractHarness;
  } catch (cause) {
    throw missingUs5Harness(cause);
  }
}

let harness: EvidenceContractHarness | undefined;

before(async () => {
  harness = await createHarness();
});

after(async () => {
  await harness?.close();
});

function requireHarness(): EvidenceContractHarness {
  assert.ok(harness, "US5 evidence harness was not initialised");
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

function assertRfc3339(value: string | undefined, label: string): void {
  assert.ok(value, `${label} must be recorded`);
  assert.ok(
    !Number.isNaN(Date.parse(value)),
    `${label} must be an RFC 3339 timestamp, got ${value}`,
  );
}

describe("US5 conclusion and evidence contract", () => {
  test("Agent proposal remains unverified and cannot confirm itself", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.workspaceWithSharedSource(),
      "seed shared-source workspace",
    );

    const proposal = expectOk(
      await subject.proposeConclusion({
        workspaceId: fixture.workspaceId,
        actor: fixture.agent,
        kind: "fact",
        body: "The upstream export is complete.",
        scope: "workspace",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "agent proposes a conclusion",
    );

    assert.equal(proposal.state, "unverified", "Agent text is a proposal, not a confirmed fact");
    assert.equal(proposal.proposedBy, fixture.agent.id);
    assert.equal(proposal.confirmedBy, undefined, "A proposal cannot name a confirmer");
    assert.equal(proposal.confirmedAt, undefined, "A proposal cannot claim a confirmation time");
    assert.equal(proposal.currentVersion, 1);

    const selfConfirmation = await subject.reviewConclusion({
      workspaceId: fixture.workspaceId,
      conclusionId: proposal.id,
      actor: fixture.agent,
      newState: "confirmed",
      reason: "The model is 0.99 confident.",
      sourceVersionIds: [fixture.sourceVersionId],
    });
    expectError(selfConfirmation, 403, "permission_denied", "agent self-confirmation");

    const afterAttempt = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
      }),
      "read review history after rejected self-confirmation",
    );
    assert.deepEqual(afterAttempt, [], "A rejected confirmation must not create a review record");
  });

  test("Only a member with review authority can confirm and the record keeps identity and time", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.workspaceWithSharedSource(),
      "seed shared-source workspace",
    );

    const proposal = expectOk(
      await subject.proposeConclusion({
        workspaceId: fixture.workspaceId,
        actor: fixture.agent,
        kind: "decision",
        body: "Use the reviewed vendor for the migration.",
        scope: "workspace",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "agent proposes a decision",
    );

    expectError(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.observer,
        newState: "confirmed",
        reason: "Observer agrees.",
      }),
      403,
      "permission_denied",
      "observer without canReview",
    );

    const confirmed = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
        newState: "confirmed",
        reason: "Checked the linked source version and scope.",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "authorized reviewer confirms",
    );

    assert.equal(confirmed.conclusion.state, "confirmed");
    assert.equal(confirmed.conclusion.confirmedBy, fixture.reviewer.id);
    assert.equal(confirmed.conclusion.currentVersion, 2);
    assertRfc3339(confirmed.conclusion.confirmedAt, "Conclusion.confirmedAt");
    assertRfc3339(confirmed.conclusion.lastReviewedAt, "Conclusion.lastReviewedAt");

    assert.equal(confirmed.review.conclusionId, proposal.id);
    assert.equal(confirmed.review.previousState, "unverified");
    assert.equal(confirmed.review.newState, "confirmed");
    assert.equal(confirmed.review.reason, "Checked the linked source version and scope.");
    assert.equal(confirmed.review.reviewedBy, fixture.reviewer.id);
    assertRfc3339(confirmed.review.reviewedAt, "ReviewRecord.reviewedAt");
    assert.deepEqual(confirmed.review.sourceVersionIds, [fixture.sourceVersionId]);

    const history = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
      }),
      "read confirmation history",
    );
    assert.equal(history.length, 1);
    assert.deepEqual(history[0], confirmed.review);
  });

  test("Confirmation is blocked when the cited evidence is no longer valid", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.workspaceWithSharedSource(),
      "seed shared-source workspace",
    );

    const proposal = expectOk(
      await subject.proposeConclusion({
        workspaceId: fixture.workspaceId,
        actor: fixture.agent,
        kind: "fact",
        body: "The source still supports the completion criterion.",
        scope: "workspace",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "propose conclusion with source",
    );

    const revoked = expectOk(
      await subject.changeSourceState({
        workspaceId: fixture.workspaceId,
        sourceId: fixture.sourceId,
        actor: fixture.reviewer,
        state: "revoked",
        reason: "The source owner withdrew the statement.",
      }),
      "revoke shared source",
    );
    assert.equal(revoked.source.state, "revoked");

    expectError(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
        newState: "confirmed",
        reason: "Confirming without usable evidence.",
      }),
      422,
      "evidence_incomplete",
      "confirm with revoked evidence",
    );

    const history = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
      }),
      "read history after blocked confirmation",
    );
    assert.deepEqual(
      history,
      [],
      "A blocked confirmation cannot append a false confirmation record",
    );
  });

  test("Review decisions require a reason and remain append-only across invalidation and re-review", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.workspaceWithSharedSource(),
      "seed shared-source workspace",
    );

    const proposal = expectOk(
      await subject.proposeConclusion({
        workspaceId: fixture.workspaceId,
        actor: fixture.agent,
        kind: "assumption",
        body: "The external service will keep the old response format.",
        scope: "workspace",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "propose assumption",
    );

    expectError(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
        newState: "confirmed",
        reason: "",
      }),
      400,
      "invalid_request",
      "blank review reason",
    );

    const invalidReview = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
        newState: "invalid",
        reason: "The source contradicts the assumption.",
      }),
      "mark conclusion invalid",
    );
    assert.equal(invalidReview.review.previousState, "unverified");
    assert.equal(invalidReview.review.newState, "invalid");

    const reconfirmed = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
        newState: "confirmed",
        reason: "A newer source version resolves the contradiction.",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "confirm after re-review",
    );
    assert.equal(reconfirmed.review.previousState, "invalid");

    const history = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
      }),
      "read append-only review history",
    );
    assert.equal(history.length, 2, "Each review must append a record");
    assert.deepEqual(
      history[0],
      invalidReview.review,
      "The earlier invalidation must not be rewritten",
    );
    assert.deepEqual(history[1], reconfirmed.review);
    assert.ok(
      history[0].reviewedAt <= history[1].reviewedAt,
      "Review history must preserve chronological order",
    );
  });

  test("Source state changes are permissioned and keep the canonical attribution fields", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.workspaceWithSharedSource(),
      "seed shared-source workspace",
    );

    expectError(
      await subject.changeSourceState({
        workspaceId: fixture.workspaceId,
        sourceId: fixture.sourceId,
        actor: fixture.observer,
        state: "revoked",
        reason: "Observer tries to revoke.",
      }),
      403,
      "permission_denied",
      "observer changing source state",
    );

    const updated = expectOk(
      await subject.changeSourceState({
        workspaceId: fixture.workspaceId,
        sourceId: fixture.sourceId,
        actor: fixture.reviewer,
        state: "invalid",
        reason: "The publisher retracted the source.",
      }),
      "authorized source state change",
    );

    assert.equal(updated.source.id, fixture.sourceId);
    assert.equal(updated.source.workspaceId, fixture.workspaceId);
    assert.equal(updated.source.state, "invalid");
    assert.equal(updated.source.currentVersionId, fixture.sourceVersionId);
    assertRfc3339(updated.source.lastConfirmedAt, "EvidenceSource.lastConfirmedAt");
    assert.equal(typeof updated.source.externalMonitoring, "boolean");
  });

  test("Evidence exceptions are owner-only, require a reason, and do not erase review history", async () => {
    const subject = requireHarness();
    const fixture = expectOk(
      await subject.seed.workspaceWithSharedSource(),
      "seed shared-source workspace",
    );

    const proposal = expectOk(
      await subject.proposeConclusion({
        workspaceId: fixture.workspaceId,
        actor: fixture.agent,
        kind: "decision",
        body: "Ship the migration despite one unavailable source.",
        scope: "workspace",
        sourceVersionIds: [fixture.sourceVersionId],
      }),
      "propose decision",
    );

    const invalidReview = expectOk(
      await subject.reviewConclusion({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
        newState: "invalid",
        reason: "Evidence was withdrawn.",
      }),
      "record invalidation before exception",
    );

    expectError(
      await subject.recordEvidenceException({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        conclusionIds: [proposal.id],
        actor: fixture.reviewer,
        reason: "Reviewer is not the owner.",
      }),
      403,
      "permission_denied",
      "non-owner evidence exception",
    );

    expectError(
      await subject.recordEvidenceException({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        conclusionIds: [proposal.id],
        actor: fixture.owner,
        reason: "",
      }),
      400,
      "invalid_request",
      "blank evidence exception reason",
    );

    const exception = expectOk(
      await subject.recordEvidenceException({
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        conclusionIds: [proposal.id],
        actor: fixture.owner,
        reason: "Proceeding with an explicitly recorded residual evidence risk.",
      }),
      "owner records evidence exception",
    );

    assert.ok(exception.id, "EvidenceException.id must be assigned");
    assert.equal(exception.runId, fixture.runId);
    assert.deepEqual(exception.conclusionIds, [proposal.id]);
    assert.equal(exception.approvedBy, fixture.owner.id);
    assert.equal(
      exception.reason,
      "Proceeding with an explicitly recorded residual evidence risk.",
    );
    assertRfc3339(exception.createdAt, "EvidenceException.createdAt");

    const history = expectOk(
      await subject.getReviewHistory({
        workspaceId: fixture.workspaceId,
        conclusionId: proposal.id,
        actor: fixture.reviewer,
      }),
      "read history after exception",
    );
    assert.equal(
      history.length,
      1,
      "An exception is not a review record and must not add or remove one",
    );
    assert.deepEqual(
      history[0],
      invalidReview.review,
      "The exception must not rewrite the invalidation history",
    );
  });
});
