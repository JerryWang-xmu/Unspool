/**
 * T115 / US3 / QS-03.1-3 / TO-01, TO-02, TO-04.
 *
 * RED contract for the US3 approval surface. The imports below intentionally
 * name the planned production modules from tasks T065-T067, T075-T076:
 *   - apps/runner-api/src/approvals/policy.ts
 *   - apps/runner-api/src/approvals/permit-service.ts
 *
 * Expected API (implemented by those tasks):
 *   createApprovalRequest(input) -> { request, proposal }
 *   decideApproval(input) -> { request, proposal, decision?, error?, audit? }
 *   invalidateApprovalForChangedAction(input) -> { request, invalidated }
 *   issueExecutionPermit(input) -> { permit?, error? }
 *   consumeExecutionPermit(input) -> { status, permit, error? }
 *
 * Error codes mirror contracts/README.md: approval_required, approval_invalid,
 * outcome_unknown. Policy-specific codes stay explicit so tests can tell why
 * an approval was refused.
 */
import { describe, expect, it } from "vitest";
import {
  consumeExecutionPermit,
  issueExecutionPermit,
} from "../../../apps/runner-api/src/approvals/permit-service";
import {
  type ActionEnvelope,
  computeActionDigest,
  createApprovalRequest,
  DEFAULT_APPROVAL_TTL_MS,
  decideApproval,
  invalidateApprovalForChangedAction,
  isApprovalExpired,
} from "../../../apps/runner-api/src/approvals/policy";

const REQUESTER_ID = "018f2d8f-0a01-7f20-80b1-aaaaaaaaaaa1";
const APPROVER_ID = "018f2d8f-0a02-7f20-80b1-aaaaaaaaaaa2";
const ADMIN_ID = "018f2d8f-0a03-7f20-80b1-aaaaaaaaaaa3";
const OUTSIDER_ID = "018f2d8f-0a04-7f20-80b1-aaaaaaaaaaa4";
const REQUEST_ID = "018f2d8f-0a05-7f20-80b1-aaaaaaaaaaa5";
const PROPOSAL_ID = "018f2d8f-0a06-7f20-80b1-aaaaaaaaaaa6";
const PERMIT_ID = "018f2d8f-0a07-7f20-80b1-aaaaaaaaaaa7";
const ATTEMPT_ID = "018f2d8f-0a08-7f20-80b1-aaaaaaaaaaa8";
const POLICY_REVISION = 7;
const BASE_TIME = new Date("2026-11-22T10:00:00.000Z");
const BASE_DIGEST = `sha256:${"a".repeat(64)}`;

const BASE_ACTION: ActionEnvelope = {
  toolName: "write_file",
  canonicalArgs: { path: "report.md", content: "new body" },
  workingDirectory: "/workspace",
  target: "report.md",
  recipients: ["team:unspool"],
  baseResourceVersions: [{ id: "report.md", version: "3" }],
};

const INDEPENDENT_APPROVER = {
  approverIds: [APPROVER_ID],
  allowRequesterSelfApproval: false,
};

function createPending(overrides: Partial<Parameters<typeof createApprovalRequest>[0]> = {}) {
  return createApprovalRequest({
    id: REQUEST_ID,
    actionProposalId: PROPOSAL_ID,
    requesterId: REQUESTER_ID,
    action: BASE_ACTION,
    purpose: "Publish the reviewed report",
    impact: "Overwrites report.md and emits one external notification",
    risk: "high",
    displayArgs: { path: "report.md", content: "new body" },
    secretRefs: [],
    policyRevision: POLICY_REVISION,
    now: BASE_TIME,
    ...overrides,
  });
}

function approve(
  created = createPending(),
  actorId = APPROVER_ID,
  approverPolicy = INDEPENDENT_APPROVER,
) {
  return decideApproval({
    request: created.request,
    proposal: created.proposal,
    actorId,
    decision: "approved",
    actionDigest: created.proposal.actionDigest,
    now: BASE_TIME,
    approverPolicy,
  });
}

function reject(created = createPending()) {
  return decideApproval({
    request: created.request,
    proposal: created.proposal,
    actorId: APPROVER_ID,
    decision: "rejected",
    actionDigest: created.proposal.actionDigest,
    reason: "The impact is broader than the task requires.",
    now: BASE_TIME,
    approverPolicy: INDEPENDENT_APPROVER,
  });
}

function issue(decided = approve(), now = BASE_TIME) {
  return issueExecutionPermit({
    id: PERMIT_ID,
    request: decided.request,
    proposal: decided.proposal,
    decision: decided.decision,
    runAttemptId: ATTEMPT_ID,
    policyRevision: POLICY_REVISION,
    now,
  });
}

function issueAndConsume() {
  const issued = issue();
  const consumed = consumeExecutionPermit({
    permit: issued.permit!,
    actionDigest: issued.permit!.actionDigest,
    runAttemptId: ATTEMPT_ID,
    policyRevision: POLICY_REVISION,
    now: new Date(BASE_TIME.getTime() + 1_000),
  });
  return { issued, consumed };
}

describe("approval expiry contract", () => {
  it("defaults to a fifteen-minute window and expires exactly at the deadline", () => {
    expect(DEFAULT_APPROVAL_TTL_MS).toBe(15 * 60 * 1_000);

    const { request } = createPending();
    expect(request.state).toBe("pending");
    expect(Date.parse(request.expiresAt)).toBe(BASE_TIME.getTime() + 15 * 60 * 1_000);
    expect(isApprovalExpired(request, new Date("2026-11-22T10:14:59.999Z"))).toBe(false);
    expect(isApprovalExpired(request, new Date("2026-11-22T10:15:00.000Z"))).toBe(true);
  });

  it("rejects a decision at the deadline instead of leaving an executable approval behind", () => {
    const created = createPending();
    const late = decideApproval({
      request: created.request,
      proposal: created.proposal,
      actorId: APPROVER_ID,
      decision: "approved",
      actionDigest: created.proposal.actionDigest,
      now: new Date("2026-11-22T10:15:00.000Z"),
      approverPolicy: INDEPENDENT_APPROVER,
    });

    expect(late.decision).toBeUndefined();
    expect(late.request.state).toBe("expired");
    expect(late.error?.code).toBe("approval_expired");
    expect(issue({ ...created, request: late.request, decision: late.decision }).error?.code).toBe(
      "approval_expired",
    );
  });
});

describe("action-digest contract", () => {
  it("binds canonical content while ignoring JSON key order", () => {
    const reordered: ActionEnvelope = {
      ...BASE_ACTION,
      canonicalArgs: {
        content: "new body",
        path: "report.md",
        nested: { beta: 2, alpha: 1 },
      },
    };
    const original: ActionEnvelope = {
      ...BASE_ACTION,
      canonicalArgs: {
        nested: { alpha: 1, beta: 2 },
        path: "report.md",
        content: "new body",
      },
    };

    expect(computeActionDigest(reordered)).toBe(computeActionDigest(original));
  });

  it.each<[string, Partial<ActionEnvelope>]>([
    ["body", { canonicalArgs: { path: "report.md", content: "changed body" } }],
    ["target", { target: "release.md" }],
    ["recipient", { recipients: ["team:outside"] }],
    ["working directory", { workingDirectory: "/other-workspace" }],
    ["base version", { baseResourceVersions: [{ id: "report.md", version: "4" }] }],
  ])("changes when the %s changes", (_label, change) => {
    const changed = computeActionDigest({ ...BASE_ACTION, ...change });
    expect(changed).not.toBe(computeActionDigest(BASE_ACTION));
  });

  it("keeps secret material behind a reference without echoing it in approver-visible args", () => {
    const secret = "canary-secret-do-not-print";
    const created = createPending({
      action: {
        ...BASE_ACTION,
        canonicalArgs: { ...BASE_ACTION.canonicalArgs, token: secret },
      },
      displayArgs: {
        path: "report.md",
        content: "new body",
        token: "<secret-ref:env/REPORT_TOKEN>",
      },
      secretRefs: ["env/REPORT_TOKEN"],
    });

    expect(JSON.stringify(created.proposal.displayArgs)).not.toContain(secret);
    expect(created.proposal.secretRefs).toEqual(["env/REPORT_TOKEN"]);
    expect(
      computeActionDigest({
        ...BASE_ACTION,
        canonicalArgs: { ...BASE_ACTION.canonicalArgs, token: "different-secret" },
      }),
    ).not.toBe(
      computeActionDigest({
        ...BASE_ACTION,
        canonicalArgs: { ...BASE_ACTION.canonicalArgs, token: secret },
      }),
    );
  });
});

describe("approval decision contract", () => {
  it("requires the decision to carry the exact current action digest", () => {
    const created = createPending();
    const result = decideApproval({
      request: created.request,
      proposal: created.proposal,
      actorId: APPROVER_ID,
      decision: "approved",
      actionDigest: BASE_DIGEST,
      now: BASE_TIME,
      approverPolicy: INDEPENDENT_APPROVER,
    });

    expect(result.decision).toBeUndefined();
    expect(result.error?.code).toBe("approval_invalid");
    expect(result.request.state).toBe("pending");
  });

  it("blocks an actor who is not an independent approver", () => {
    const created = createPending();
    const result = decideApproval({
      request: created.request,
      proposal: created.proposal,
      actorId: OUTSIDER_ID,
      decision: "approved",
      actionDigest: created.proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: INDEPENDENT_APPROVER,
    });

    expect(result.decision).toBeUndefined();
    expect(result.error?.code).toBe("not_approver");
    expect(result.request.state).toBe("pending");
  });

  it("blocks requester self-approval by default even when the requester is listed as an approver", () => {
    const created = createPending();
    const result = decideApproval({
      request: created.request,
      proposal: created.proposal,
      actorId: REQUESTER_ID,
      decision: "approved",
      actionDigest: created.proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: {
        approverIds: [REQUESTER_ID, APPROVER_ID],
        allowRequesterSelfApproval: false,
      },
    });

    expect(result.decision).toBeUndefined();
    expect(result.error?.code).toBe("self_approval_forbidden");
    expect(result.request.state).toBe("pending");
  });

  it("allows self-approval only through the explicit single-user exception and leaves a prominent audit record", () => {
    const created = createPending();
    const result = decideApproval({
      request: created.request,
      proposal: created.proposal,
      actorId: REQUESTER_ID,
      decision: "approved",
      actionDigest: created.proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: {
        approverIds: [REQUESTER_ID, APPROVER_ID],
        allowRequesterSelfApproval: false,
        singleUserException: {
          enabled: true,
          approvedBy: ADMIN_ID,
          reason: "Personal MVP trial has no second member.",
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.request.state).toBe("approved");
    expect(result.decision?.decision).toBe("approved");
    expect(result.audit?.selfApprovalExceptionUsed).toBe(true);
    expect(result.audit?.exceptionApprovedBy).toBe(ADMIN_ID);
    expect(result.audit?.note).toMatch(/single-user|exception/i);
  });

  it("makes approved, rejected, expired and invalidated states terminal", () => {
    const approved = approve();
    const afterApprove = decideApproval({
      request: approved.request,
      proposal: approved.proposal,
      actorId: APPROVER_ID,
      decision: "rejected",
      actionDigest: approved.proposal.actionDigest,
      now: new Date(BASE_TIME.getTime() + 1_000),
      approverPolicy: INDEPENDENT_APPROVER,
    });
    expect(afterApprove.error?.code).toBe("already_terminal");
    expect(afterApprove.request.state).toBe("approved");

    const rejected = reject();
    const afterReject = decideApproval({
      request: rejected.request,
      proposal: rejected.proposal,
      actorId: APPROVER_ID,
      decision: "approved",
      actionDigest: rejected.proposal.actionDigest,
      now: new Date(BASE_TIME.getTime() + 1_000),
      approverPolicy: INDEPENDENT_APPROVER,
    });
    expect(afterReject.error?.code).toBe("already_terminal");
    expect(afterReject.request.state).toBe("rejected");

    const created = createPending();
    const changed = invalidateApprovalForChangedAction({
      request: created.request,
      proposal: created.proposal,
      nextAction: { ...BASE_ACTION, target: "release.md" },
      reason: "scope_changed",
      now: new Date(BASE_TIME.getTime() + 1_000),
    });
    expect(changed.request.state).toBe("invalidated");
    expect(issue({ ...created, request: changed.request }).error?.code).toBe("approval_invalid");
  });
});

describe("content and scope invalidation contract", () => {
  it.each<[string, Partial<ActionEnvelope>]>([
    ["body", { canonicalArgs: { path: "report.md", content: "materially changed" } }],
    ["target", { target: "release.md" }],
    ["recipient", { recipients: ["team:outside"] }],
    ["working directory", { workingDirectory: "/other-workspace" }],
    ["base version", { baseResourceVersions: [{ id: "report.md", version: "4" }] }],
  ])("invalidates an approved request after a %s change", (_label, change) => {
    const approved = approve();
    const invalidated = invalidateApprovalForChangedAction({
      request: approved.request,
      proposal: approved.proposal,
      nextAction: { ...BASE_ACTION, ...change },
      reason: "scope_changed",
      now: new Date(BASE_TIME.getTime() + 1_000),
    });

    expect(invalidated.invalidated).toBe(true);
    expect(invalidated.request.state).toBe("invalidated");
    expect(
      issue({ ...approved, request: invalidated.request, decision: approved.decision }).error?.code,
    ).toBe("approval_invalid");
  });

  it("does not invalidate an approval when the canonical action is unchanged", () => {
    const approved = approve();
    const unchanged = invalidateApprovalForChangedAction({
      request: approved.request,
      proposal: approved.proposal,
      nextAction: {
        ...BASE_ACTION,
        canonicalArgs: { content: "new body", path: "report.md" },
      },
      reason: "scope_changed",
      now: new Date(BASE_TIME.getTime() + 1_000),
    });

    expect(unchanged.invalidated).toBe(false);
    expect(unchanged.request.state).toBe("approved");
    expect(issue({ ...approved, request: unchanged.request }).error).toBeUndefined();
  });
});

describe("single-use execution-permit contract", () => {
  it("binds the permit to decision digest, attempt and policy revision", () => {
    const issued = issue();
    expect(issued.error).toBeUndefined();
    expect(issued.permit?.actionDigest).toBe(computeActionDigest(BASE_ACTION));
    expect(issued.permit?.runAttemptId).toBe(ATTEMPT_ID);
    expect(issued.permit?.policyRevision).toBe(POLICY_REVISION);

    const wrongDigest = consumeExecutionPermit({
      permit: issued.permit!,
      actionDigest: `sha256:${"b".repeat(64)}`,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: BASE_TIME,
    });
    expect(wrongDigest.status).toBe("rejected");
    expect(wrongDigest.error?.code).toBe("digest_mismatch");

    const wrongAttempt = consumeExecutionPermit({
      permit: issued.permit!,
      actionDigest: issued.permit!.actionDigest,
      runAttemptId: "018f2d8f-0a09-7f20-80b1-aaaaaaaaaaa9",
      policyRevision: POLICY_REVISION,
      now: BASE_TIME,
    });
    expect(wrongAttempt.status).toBe("rejected");
    expect(wrongAttempt.error?.code).toBe("attempt_mismatch");

    const wrongPolicy = consumeExecutionPermit({
      permit: issued.permit!,
      actionDigest: issued.permit!.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION - 1,
      now: BASE_TIME,
    });
    expect(wrongPolicy.status).toBe("rejected");
    expect(wrongPolicy.error?.code).toBe("policy_mismatch");
  });

  it("consumes the permit atomically exactly once", () => {
    const issued = issue();
    const first = consumeExecutionPermit({
      permit: issued.permit!,
      actionDigest: issued.permit!.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date(BASE_TIME.getTime() + 1_000),
    });
    expect(first.status).toBe("consumed");
    expect(first.permit.consumedAt).toBe("2026-11-22T10:00:01.000Z");

    const second = consumeExecutionPermit({
      permit: first.permit,
      actionDigest: first.permit.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date(BASE_TIME.getTime() + 2_000),
    });
    expect(second.status).toBe("rejected");
    expect(second.error?.code).toBe("already_consumed");
    expect(second.permit.consumptionResult).toBe("succeeded");
  });

  it("never issues a permit for rejected, expired or invalidated approvals", () => {
    const rejected = reject();
    expect(issue(rejected).error?.code).toBe("approval_invalid");

    const expired = createPending();
    expect(
      issue({ ...expired, request: { ...expired.request, state: "expired" } }).error?.code,
    ).toBe("approval_expired");

    const invalidated = createPending();
    const changed = invalidateApprovalForChangedAction({
      request: invalidated.request,
      proposal: invalidated.proposal,
      nextAction: { ...BASE_ACTION, target: "release.md" },
      reason: "scope_changed",
      now: BASE_TIME,
    });
    expect(
      issue({ ...invalidated, request: changed.request, decision: undefined }).error?.code,
    ).toBe("approval_invalid");
  });

  it("rejects consumption after permit expiry", () => {
    const issued = issue();
    const expired = consumeExecutionPermit({
      permit: issued.permit!,
      actionDigest: issued.permit!.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date("2026-11-22T10:15:00.000Z"),
    });

    expect(expired.status).toBe("rejected");
    expect(expired.error?.code).toBe("permit_expired");
  });

  it("cannot consume a permit a second time after the result became unknown", () => {
    const issued = issue();
    const unknown = consumeExecutionPermit({
      permit: issued.permit!,
      actionDigest: issued.permit!.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date(BASE_TIME.getTime() + 1_000),
      executionResult: "outcome_unknown",
    });
    expect(unknown.status).toBe("consumed");
    expect(unknown.permit.consumptionResult).toBe("outcome_unknown");

    const retry = consumeExecutionPermit({
      permit: unknown.permit,
      actionDigest: unknown.permit.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date(BASE_TIME.getTime() + 2_000),
    });
    expect(retry.status).toBe("rejected");
    expect(["already_consumed", "outcome_unknown"]).toContain(retry.error?.code);
    expect(retry.permit.consumptionResult).toBe("outcome_unknown");
  });

  it("allows the unchanged positive control to consume its own permit once", () => {
    const { consumed } = issueAndConsume();
    expect(consumed.status).toBe("consumed");
    expect(consumed.permit.consumptionResult).toBe("succeeded");
  });
});
