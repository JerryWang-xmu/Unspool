import { describe, expect, it } from "vitest";
import {
  type ActionEnvelope,
  type ActionProposal,
  computeActionDigest,
  createActionProposal,
  toActionProposalView,
} from "../src/action-proposal.js";
import {
  createApprovalDecision,
  type DecideApprovalResult,
  decideApproval,
} from "../src/approval-decision.js";
import {
  type ApprovalRequest,
  createApprovalRequest,
  DEFAULT_APPROVAL_TTL_MS,
  invalidateApprovalForChangedAction,
  isApprovalExpired,
} from "../src/approval-request.js";
import {
  type ConsumeExecutionPermitResult,
  consumeExecutionPermit,
  type ExecutionPermit,
  issueExecutionPermit,
} from "../src/execution-permit.js";

const REQUESTER_ID = "018f2d8f-0a01-7f20-80b1-aaaaaaaaaaa1";
const APPROVER_ID = "018f2d8f-0a02-7f20-80b1-aaaaaaaaaaa2";
const ADMIN_ID = "018f2d8f-0a03-7f20-80b1-aaaaaaaaaaa3";
const OUTSIDER_ID = "018f2d8f-0a04-7f20-80b1-aaaaaaaaaaa4";
const REQUEST_ID = "018f2d8f-0a05-7f20-80b1-aaaaaaaaaaa5";
const PROPOSAL_ID = "018f2d8f-0a06-7f20-80b1-aaaaaaaaaaa6";
const PERMIT_ID = "018f2d8f-0a07-7f20-80b1-aaaaaaaaaaa7";
const ATTEMPT_ID = "018f2d8f-0a08-7f20-80b1-aaaaaaaaaaa8";
const DECISION_ID = "018f2d8f-0a09-7f20-80b1-aaaaaaaaaaa9";
const POLICY_REVISION = 7;
const BASE_TIME = new Date("2026-11-22T10:00:00.000Z");
const DEADLINE = new Date("2026-11-22T10:15:00.000Z");

const BASE_ACTION: ActionEnvelope = {
  toolName: "write_file",
  canonicalArgs: { path: "report.md", content: "new body" },
  workingDirectory: "/workspace",
  environment: { MODE: "test" },
  target: "report.md",
  recipients: ["team:unspool"],
  baseResourceVersions: [{ id: "report.md", version: "3" }],
};

const INDEPENDENT_APPROVER = {
  approverIds: [APPROVER_ID],
  allowRequesterSelfApproval: false,
};

function createProposal(overrides: Partial<ActionEnvelope> = {}): ActionProposal {
  return createActionProposal({
    id: PROPOSAL_ID,
    runId: "018f2d8f-0b01-7f20-80b1-bbbbbbbbbbb1",
    attemptId: ATTEMPT_ID,
    toolCallId: "call-1",
    action: { ...BASE_ACTION, ...overrides },
    displayArgs: { path: "report.md", content: "new body" },
    secretRefs: [],
    purpose: "Publish the reviewed report",
    impact: "Overwrites report.md",
    risk: "high",
    createdAt: BASE_TIME.toISOString(),
  });
}

function createPending(
  overrides: Partial<Parameters<typeof createApprovalRequest>[0]> = {},
): ApprovalRequest {
  return createApprovalRequest({
    id: REQUEST_ID,
    actionProposalId: PROPOSAL_ID,
    requesterId: REQUESTER_ID,
    requiredApproverPolicy: INDEPENDENT_APPROVER,
    policyRevision: POLICY_REVISION,
    now: BASE_TIME,
    ...overrides,
  });
}

function approve(proposal = createProposal(), request = createPending()): DecideApprovalResult {
  return decideApproval({
    id: DECISION_ID,
    request,
    proposal,
    actorId: APPROVER_ID,
    decision: "approved",
    actionDigest: proposal.actionDigest,
    now: BASE_TIME,
    approverPolicy: INDEPENDENT_APPROVER,
  });
}

function requirePermit(result: {
  permit?: ExecutionPermit;
  error?: { code: string };
}): ExecutionPermit {
  if (!result.permit) throw new Error(`Expected permit, got ${result.error?.code ?? "none"}`);
  return result.permit;
}

function requireConsumed(result: ConsumeExecutionPermitResult): ExecutionPermit {
  if (result.status !== "consumed") {
    throw new Error(`Expected consumed permit, got ${result.error?.code ?? "none"}`);
  }
  return result.permit;
}

describe("ActionProposal digest", () => {
  it("is stable across object key order and binds real action fields", () => {
    const reordered: ActionEnvelope = {
      ...BASE_ACTION,
      canonicalArgs: {
        content: "new body",
        nested: { beta: 2, alpha: 1 },
        path: "report.md",
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

    for (const change of [
      { canonicalArgs: { path: "report.md", content: "changed body" } },
      { target: "release.md" },
      { recipients: ["team:outside"] },
      { workingDirectory: "/other-workspace" },
      { baseResourceVersions: [{ id: "report.md", version: "4" }] },
      { environment: { MODE: "production" } },
    ] satisfies Partial<ActionEnvelope>[]) {
      expect(computeActionDigest({ ...BASE_ACTION, ...change })).not.toBe(
        computeActionDigest(BASE_ACTION),
      );
    }
  });

  it("hashes canonical secrets but never exposes them through the approval view", () => {
    const secret = "canary-secret-do-not-print";
    const proposal = createActionProposal({
      id: PROPOSAL_ID,
      runId: "018f2d8f-0b01-7f20-80b1-bbbbbbbbbbb1",
      attemptId: ATTEMPT_ID,
      toolCallId: "call-1",
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
      purpose: "Publish the reviewed report",
      impact: "Overwrites report.md",
      risk: "high",
      createdAt: BASE_TIME.toISOString(),
    });

    const view = toActionProposalView(proposal);

    expect("canonicalArgs" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.secretRefs).toEqual(["env/REPORT_TOKEN"]);
    expect(
      computeActionDigest({
        ...BASE_ACTION,
        canonicalArgs: { ...BASE_ACTION.canonicalArgs, token: "different-secret" },
      }),
    ).not.toBe(computeActionDigest({ ...BASE_ACTION, canonicalArgs: proposal.canonicalArgs }));
  });
});

describe("ApprovalRequest", () => {
  it("defaults to fifteen minutes and expires exactly at the deadline", () => {
    expect(DEFAULT_APPROVAL_TTL_MS).toBe(15 * 60 * 1_000);

    const request = createPending();
    expect(request.state).toBe("pending");
    expect(Date.parse(request.expiresAt)).toBe(DEADLINE.getTime());
    expect(isApprovalExpired(request, new Date(DEADLINE.getTime() - 1))).toBe(false);
    expect(isApprovalExpired(request, DEADLINE)).toBe(true);
  });

  it("invalidates changed content but keeps an unchanged canonical action", () => {
    const proposal = createProposal();
    const request = createPending();

    const changed = invalidateApprovalForChangedAction({
      request,
      proposal,
      nextAction: { ...BASE_ACTION, target: "release.md" },
      now: new Date(BASE_TIME.getTime() + 1_000),
      reason: "scope_changed",
    });

    expect(changed.invalidated).toBe(true);
    expect(changed.request.state).toBe("invalidated");

    const unchanged = invalidateApprovalForChangedAction({
      request,
      proposal,
      nextAction: {
        ...BASE_ACTION,
        canonicalArgs: { content: "new body", path: "report.md" },
      },
      now: new Date(BASE_TIME.getTime() + 1_000),
    });

    expect(unchanged.invalidated).toBe(false);
    expect(unchanged.request.state).toBe("pending");
  });
});

describe("ApprovalDecision", () => {
  it("rejects late decisions and records the request as expired", () => {
    const proposal = createProposal();
    const request = createPending();

    const result = decideApproval({
      id: DECISION_ID,
      request,
      proposal,
      actorId: APPROVER_ID,
      decision: "approved",
      actionDigest: proposal.actionDigest,
      now: DEADLINE,
      approverPolicy: INDEPENDENT_APPROVER,
    });

    expect(result.decision).toBeUndefined();
    expect(result.request.state).toBe("expired");
    expect(result.error?.code).toBe("approval_expired");
  });

  it("binds the exact current action digest and blocks non-approvers", () => {
    const proposal = createProposal();
    const request = createPending();

    const wrongDigest = decideApproval({
      id: DECISION_ID,
      request,
      proposal,
      actorId: APPROVER_ID,
      decision: "approved",
      actionDigest: `sha256:${"b".repeat(64)}`,
      now: BASE_TIME,
      approverPolicy: INDEPENDENT_APPROVER,
    });
    expect(wrongDigest.error?.code).toBe("approval_invalid");
    expect(wrongDigest.request.state).toBe("pending");

    const outsider = decideApproval({
      id: DECISION_ID,
      request,
      proposal,
      actorId: OUTSIDER_ID,
      decision: "approved",
      actionDigest: proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: INDEPENDENT_APPROVER,
    });
    expect(outsider.error?.code).toBe("not_approver");
    expect(outsider.request.state).toBe("pending");
  });

  it("blocks self-approval unless the single-user exception is explicitly granted", () => {
    const proposal = createProposal();
    const request = createPending({
      requiredApproverPolicy: {
        approverIds: [REQUESTER_ID, APPROVER_ID],
        allowRequesterSelfApproval: false,
      },
    });

    const forbidden = decideApproval({
      id: DECISION_ID,
      request,
      proposal,
      actorId: REQUESTER_ID,
      decision: "approved",
      actionDigest: proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: request.requiredApproverPolicy,
    });

    expect(forbidden.error?.code).toBe("self_approval_forbidden");
    expect(forbidden.request.state).toBe("pending");

    const allowed = decideApproval({
      id: DECISION_ID,
      request,
      proposal,
      actorId: REQUESTER_ID,
      decision: "approved",
      actionDigest: proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: {
        ...request.requiredApproverPolicy,
        singleUserException: {
          enabled: true,
          approvedBy: ADMIN_ID,
          reason: "Personal MVP trial has no second member",
        },
      },
    });

    expect(allowed.error).toBeUndefined();
    expect(allowed.request.state).toBe("approved");
    expect(allowed.decision?.decision).toBe("approved");
    expect(allowed.audit?.selfApprovalExceptionUsed).toBe(true);
    expect(allowed.audit?.exceptionApprovedBy).toBe(ADMIN_ID);
    expect(allowed.audit?.note).toMatch(/single-user|exception/i);
  });

  it("keeps approved and rejected decisions terminal", () => {
    const proposal = createProposal();
    const approvedRequest = approve(proposal);
    if (!approvedRequest.decision) throw new Error("expected approved decision");

    const afterApproval = decideApproval({
      id: "018f2d8f-0a0a-7f20-80b1-aaaaaaaaaaa0",
      request: approvedRequest.request,
      proposal,
      actorId: APPROVER_ID,
      decision: "rejected",
      actionDigest: proposal.actionDigest,
      now: new Date(BASE_TIME.getTime() + 1_000),
      approverPolicy: INDEPENDENT_APPROVER,
    });
    expect(afterApproval.error?.code).toBe("already_terminal");
    expect(afterApproval.request.state).toBe("approved");

    const rejected = decideApproval({
      id: "018f2d8f-0a0b-7f20-80b1-aaaaaaaaaaa1",
      request: createPending(),
      proposal,
      actorId: APPROVER_ID,
      decision: "rejected",
      actionDigest: proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: INDEPENDENT_APPROVER,
      reason: "Impact is broader than the task requires",
    });

    expect(rejected.decision?.decision).toBe("rejected");
    expect(rejected.decision?.reason).toBe("Impact is broader than the task requires");
    expect(rejected.request.state).toBe("rejected");
  });

  it("never issues a permit for rejected, expired, or invalidated requests", () => {
    const proposal = createProposal();
    const rejected = decideApproval({
      id: DECISION_ID,
      request: createPending(),
      proposal,
      actorId: APPROVER_ID,
      decision: "rejected",
      actionDigest: proposal.actionDigest,
      now: BASE_TIME,
      approverPolicy: INDEPENDENT_APPROVER,
    });

    expect(
      issueExecutionPermit({
        id: PERMIT_ID,
        request: rejected.request,
        proposal,
        decision: rejected.decision,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: BASE_TIME,
      }).error?.code,
    ).toBe("approval_invalid");

    expect(
      issueExecutionPermit({
        id: PERMIT_ID,
        request: { ...createPending(), state: "expired" },
        proposal,
        decision: createApprovalDecision({
          id: DECISION_ID,
          approvalRequestId: REQUEST_ID,
          decision: "expired",
          decidedBy: "system",
          decidedAt: DEADLINE,
          actionDigest: proposal.actionDigest,
        }),
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: DEADLINE,
      }).error?.code,
    ).toBe("approval_expired");

    const approved = approve(proposal);
    if (!approved.decision) throw new Error("expected approved decision");
    const invalidated = invalidateApprovalForChangedAction({
      request: approved.request,
      proposal,
      nextAction: { ...BASE_ACTION, target: "release.md" },
      now: new Date(BASE_TIME.getTime() + 1_000),
    });

    expect(
      issueExecutionPermit({
        id: PERMIT_ID,
        request: invalidated.request,
        proposal,
        decision: approved.decision,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: new Date(BASE_TIME.getTime() + 1_000),
      }).error?.code,
    ).toBe("approval_invalid");
  });
});

describe("ExecutionPermit", () => {
  it("binds decision digest, attempt, and policy revision and consumes exactly once", () => {
    const proposal = createProposal();
    const approved = approve(proposal);
    if (!approved.decision) throw new Error("expected approved decision");

    const permit = requirePermit(
      issueExecutionPermit({
        id: PERMIT_ID,
        request: approved.request,
        proposal,
        decision: approved.decision,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: BASE_TIME,
      }),
    );

    expect(permit.actionDigest).toBe(proposal.actionDigest);
    expect(permit.runAttemptId).toBe(ATTEMPT_ID);
    expect(permit.policyRevision).toBe(POLICY_REVISION);
    expect(permit.expiresAt).toBe(approved.request.expiresAt);

    const wrongDigest = consumeExecutionPermit({
      permit,
      actionDigest: `sha256:${"b".repeat(64)}`,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: BASE_TIME,
    });
    expect(wrongDigest.error?.code).toBe("digest_mismatch");

    const wrongAttempt = consumeExecutionPermit({
      permit,
      actionDigest: permit.actionDigest,
      runAttemptId: "018f2d8f-0a0f-7f20-80b1-aaaaaaaaaaa0",
      policyRevision: POLICY_REVISION,
      now: BASE_TIME,
    });
    expect(wrongAttempt.error?.code).toBe("attempt_mismatch");

    const wrongPolicy = consumeExecutionPermit({
      permit,
      actionDigest: permit.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION - 1,
      now: BASE_TIME,
    });
    expect(wrongPolicy.error?.code).toBe("policy_mismatch");

    const consumed = requireConsumed(
      consumeExecutionPermit({
        permit,
        actionDigest: permit.actionDigest,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: new Date(BASE_TIME.getTime() + 1_000),
      }),
    );
    expect(consumed.consumedAt).toBe("2026-11-22T10:00:01.000Z");
    expect(consumed.consumptionResult).toBe("succeeded");

    const second = consumeExecutionPermit({
      permit: consumed,
      actionDigest: consumed.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date(BASE_TIME.getTime() + 2_000),
    });
    expect(second.status).toBe("rejected");
    expect(second.error?.code).toBe("already_consumed");
    expect(second.permit.consumptionResult).toBe("succeeded");
  });

  it("rejects consumption after the permit deadline", () => {
    const proposal = createProposal();
    const approved = approve(proposal);
    if (!approved.decision) throw new Error("expected approved decision");

    const permit = requirePermit(
      issueExecutionPermit({
        id: PERMIT_ID,
        request: approved.request,
        proposal,
        decision: approved.decision,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: BASE_TIME,
      }),
    );

    const expired = consumeExecutionPermit({
      permit,
      actionDigest: permit.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: DEADLINE,
    });

    expect(expired.status).toBe("rejected");
    expect(expired.error?.code).toBe("permit_expired");
  });

  it("cannot consume again after an unknown execution outcome", () => {
    const proposal = createProposal();
    const approved = approve(proposal);
    if (!approved.decision) throw new Error("expected approved decision");

    const permit = requirePermit(
      issueExecutionPermit({
        id: PERMIT_ID,
        request: approved.request,
        proposal,
        decision: approved.decision,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: BASE_TIME,
      }),
    );

    const unknown = requireConsumed(
      consumeExecutionPermit({
        permit,
        actionDigest: permit.actionDigest,
        runAttemptId: ATTEMPT_ID,
        policyRevision: POLICY_REVISION,
        now: new Date(BASE_TIME.getTime() + 1_000),
        executionResult: "outcome_unknown",
      }),
    );
    expect(unknown.consumptionResult).toBe("outcome_unknown");

    const retry = consumeExecutionPermit({
      permit: unknown,
      actionDigest: unknown.actionDigest,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now: new Date(BASE_TIME.getTime() + 2_000),
    });
    expect(retry.status).toBe("rejected");
    expect(retry.error?.code).toBe("outcome_unknown");
    expect(retry.permit.consumptionResult).toBe("outcome_unknown");
  });
});
