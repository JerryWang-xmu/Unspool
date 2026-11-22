/**
 * T116 / US3 / QS-03.1-2 / TO-01, TO-02, TO-12.
 *
 * RED integration boundary for the real side-effect edge. The planned surface:
 *   - packages/pi-adapter/src/approval-gate.ts (T076)
 *   - apps/execution-worker/src/tools/wrapper.ts (T120)
 *
 * ApprovalGate.authorize() is the last check before a tool wrapper is allowed
 * to invoke a real tool. It must re-read the persisted request/decision/permit,
 * re-check the effective action digest, consume the single-use permit, and
 * refuse when the run is stopping. executeGuardedTool() must never invoke when
 * authorize() refuses.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeGuardedTool } from "../../../apps/execution-worker/src/tools/wrapper";
import { issueExecutionPermit } from "../../../apps/runner-api/src/approvals/permit-service";
import {
  type ActionEnvelope,
  computeActionDigest,
  createApprovalRequest,
  decideApproval,
} from "../../../apps/runner-api/src/approvals/policy";
import {
  ApprovalGateError,
  createApprovalGate,
} from "../../../packages/pi-adapter/src/approval-gate";

const REQUESTER_ID = "018f2d8f-0b01-7f20-80b1-bbbbbbbbbbb1";
const APPROVER_ID = "018f2d8f-0b02-7f20-80b1-bbbbbbbbbbb2";
const ADMIN_ID = "018f2d8f-0b03-7f20-80b1-bbbbbbbbbbb3";
const REQUEST_ID = "018f2d8f-0b04-7f20-80b1-bbbbbbbbbbb4";
const PROPOSAL_ID = "018f2d8f-0b05-7f20-80b1-bbbbbbbbbbb5";
const PERMIT_ID = "018f2d8f-0b06-7f20-80b1-bbbbbbbbbbb6";
const ATTEMPT_ID = "018f2d8f-0b07-7f20-80b1-bbbbbbbbbbb7";
const POLICY_REVISION = 11;
const BASE_TIME = new Date("2026-11-22T10:00:00.000Z");
const BEFORE_HASH = createHash("sha256").update("initial canary content").digest("hex");

const FILE_ACTION: ActionEnvelope = {
  toolName: "write_file",
  canonicalArgs: { path: "canary.txt", content: "mutated by the guarded tool" },
  workingDirectory: "/workspace",
  target: "canary.txt",
  recipients: ["team:unspool"],
  baseResourceVersions: [{ id: "canary.txt", version: "1" }],
};

const EXTERNAL_ACTION: ActionEnvelope = {
  toolName: "external_notify",
  canonicalArgs: { recipient: "team:outside", messageId: "m-1" },
  workingDirectory: "/workspace",
  target: "external:notify",
  recipients: ["team:outside"],
  baseResourceVersions: [],
};

const INDEPENDENT_APPROVER = {
  approverIds: [APPROVER_ID],
  allowRequesterSelfApproval: false,
};

function pendingFor(
  action: ActionEnvelope,
  overrides: Partial<Parameters<typeof createApprovalRequest>[0]> = {},
) {
  return createApprovalRequest({
    id: REQUEST_ID,
    actionProposalId: PROPOSAL_ID,
    requesterId: REQUESTER_ID,
    action,
    purpose: "Apply the requested high-risk action",
    impact: "Mutates the canary file and may call the counting endpoint once",
    risk: "high",
    displayArgs: { path: "canary.txt" },
    secretRefs: [],
    policyRevision: POLICY_REVISION,
    now: BASE_TIME,
    ...overrides,
  });
}

type Created = ReturnType<typeof pendingFor>;
type DecisionOutcome = ReturnType<typeof decideApproval>;
type PermitOutcome = ReturnType<typeof issueExecutionPermit>;
type ApprovalBundle = Created & {
  decision?: DecisionOutcome["decision"];
  permit?: PermitOutcome["permit"];
};

let tempDir: string;
let canaryPath: string;
let now: Date;
let stored: ApprovalBundle;
let fileWrites: number;
let externalCalls: number;

function createGate() {
  return createApprovalGate({
    now: () => now,
    loadApproval: async (approvalId: string) =>
      stored.request.id === approvalId ? stored : undefined,
    invalidateApproval: async (approvalId: string, _reason: string) => {
      if (stored.request.id === approvalId) {
        stored = {
          ...stored,
          request: { ...stored.request, state: "invalidated" },
        };
      }
    },
    consumePermit: async (permit: NonNullable<PermitOutcome["permit"]>) => {
      if (stored.permit?.consumedAt !== undefined) {
        throw new ApprovalGateError(
          stored.permit.consumptionResult === "outcome_unknown"
            ? "outcome_unknown"
            : "already_consumed",
          stored.permit.consumptionResult === "outcome_unknown"
            ? "Execution permit was consumed and the outcome is unknown"
            : "Execution permit has already been consumed",
        );
      }
      stored = { ...stored, permit };
      return permit;
    },
    savePermit: async (permit: PermitOutcome["permit"]) => {
      stored = { ...stored, permit };
    },
  });
}

function approveStored(
  actorId = APPROVER_ID,
  approverPolicy: Parameters<typeof decideApproval>[0]["approverPolicy"] = INDEPENDENT_APPROVER,
) {
  const outcome = decideApproval({
    request: stored.request,
    proposal: stored.proposal,
    actorId,
    decision: "approved",
    actionDigest: stored.proposal.actionDigest,
    now,
    approverPolicy,
  });
  stored = { ...stored, request: outcome.request, decision: outcome.decision };

  if (outcome.decision?.decision === "approved") {
    const issued = issueExecutionPermit({
      id: PERMIT_ID,
      request: outcome.request,
      proposal: stored.proposal,
      decision: outcome.decision,
      runAttemptId: ATTEMPT_ID,
      policyRevision: POLICY_REVISION,
      now,
    });
    expect(issued.error).toBeUndefined();
    stored = { ...stored, permit: issued.permit };
  }

  return outcome;
}

function rejectStored() {
  const outcome = decideApproval({
    request: stored.request,
    proposal: stored.proposal,
    actorId: APPROVER_ID,
    decision: "rejected",
    actionDigest: stored.proposal.actionDigest,
    reason: "Impact exceeds the task's declared scope.",
    now,
    approverPolicy: INDEPENDENT_APPROVER,
  });
  stored = { ...stored, request: outcome.request, decision: outcome.decision };
  return outcome;
}

async function executeWith(
  invoke: () => Promise<unknown>,
  action: ActionEnvelope,
  options: { runState?: "running" | "stopping"; simulateResponseLoss?: boolean } = {},
) {
  return executeGuardedTool({
    gate: createGate(),
    approvalId: stored.request.id,
    action,
    actionDigest: computeActionDigest(action),
    runAttemptId: ATTEMPT_ID,
    policyRevision: POLICY_REVISION,
    ...options,
    invoke,
  });
}

async function executeFile(action: ActionEnvelope = FILE_ACTION) {
  return executeWith(async () => {
    fileWrites += 1;
    await writeFile(canaryPath, "mutated by the guarded tool", "utf8");
    return { wrote: "canary.txt" };
  }, action);
}

async function executeExternal(action: ActionEnvelope = EXTERNAL_ACTION) {
  return executeWith(async () => {
    externalCalls += 1;
    return { accepted: true };
  }, action);
}

async function hashCanary() {
  return createHash("sha256")
    .update(await readFile(canaryPath))
    .digest("hex");
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "unspool-us3-approval-"));
  canaryPath = join(tempDir, "canary.txt");
  await writeFile(canaryPath, "initial canary content", "utf8");
  now = new Date(BASE_TIME);
  stored = pendingFor(FILE_ACTION);
  fileWrites = 0;
  externalCalls = 0;
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("approval-before-side-effect boundary", () => {
  it("keeps a pending file action completely inert", async () => {
    const result = await executeFile();

    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_required");
    expect(fileWrites).toBe(0);
    expect(externalCalls).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
    expect(stored.request.state).toBe("pending");
    expect(result.receipts.map((receipt) => receipt.kind)).not.toContain("tool_execution_entered");
  });

  it("keeps a pending external action completely inert", async () => {
    stored = pendingFor(EXTERNAL_ACTION);
    const result = await executeExternal();

    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_required");
    expect(externalCalls).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });

  it("does not turn a closed approval page or a dropped GUI connection into an approval", async () => {
    // Closing the page and losing the GUI connection leave the persisted
    // request pending. The worker must remain blocked until an independent
    // decision is actually committed.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await executeFile();
      expect(result.status).toBe("blocked");
      expect(result.code).toBe("approval_required");
    }

    expect(stored.request.state).toBe("pending");
    expect(stored.decision).toBeUndefined();
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });

  it("leaves the canary and the external counter unchanged after rejection", async () => {
    const rejected = rejectStored();
    expect(rejected.request.state).toBe("rejected");

    const result = await executeFile();
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_invalid");
    expect(fileWrites).toBe(0);
    expect(externalCalls).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
    expect(stored.decision?.reason).toMatch(/scope/i);
  });
});

describe("deadline and late-approval boundary", () => {
  it("blocks a pending action at exactly fifteen minutes", async () => {
    now = new Date(BASE_TIME.getTime() + 15 * 60 * 1_000);
    const result = await executeFile();

    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_invalid");
    expect(result.reason).toMatch(/expired/i);
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });

  it("rejects a decision that arrives after the deadline and never executes it", async () => {
    now = new Date(BASE_TIME.getTime() + 15 * 60 * 1_000 + 1);
    const late = approveStored();

    expect(late.decision).toBeUndefined();
    expect(late.error?.code).toBe("approval_expired");
    expect(stored.request.state).toBe("expired");
    expect(stored.permit).toBeUndefined();

    const result = await executeFile();
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_invalid");
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });

  it("expires an already approved permit before it can reach the tool", async () => {
    expect(approveStored().request.state).toBe("approved");
    now = new Date(BASE_TIME.getTime() + 15 * 60 * 1_000);

    const result = await executeFile();
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_invalid");
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });
});

describe("self-approval boundary", () => {
  it("blocks the requester from approving their own high-risk action by default", async () => {
    const denied = approveStored(REQUESTER_ID, {
      approverIds: [REQUESTER_ID, APPROVER_ID],
      allowRequesterSelfApproval: false,
    });

    expect(denied.decision).toBeUndefined();
    expect(denied.error?.code).toBe("self_approval_forbidden");
    expect(stored.permit).toBeUndefined();

    const result = await executeFile();
    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_required");
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });

  it("allows the explicit single-user exception but still executes only once", async () => {
    const approved = approveStored(REQUESTER_ID, {
      approverIds: [REQUESTER_ID, APPROVER_ID],
      allowRequesterSelfApproval: false,
      singleUserException: {
        enabled: true,
        approvedBy: ADMIN_ID,
        reason: "Personal MVP trial.",
      },
    });

    expect(approved.error).toBeUndefined();
    expect(approved.audit?.selfApprovalExceptionUsed).toBe(true);
    expect(approved.audit?.exceptionApprovedBy).toBe(ADMIN_ID);

    const first = await executeFile();
    expect(first.status).toBe("succeeded");
    expect(fileWrites).toBe(1);
    expect(await hashCanary()).not.toBe(BEFORE_HASH);

    const second = await executeFile();
    expect(second.status).toBe("blocked");
    expect(second.code).toBe("already_consumed");
    expect(fileWrites).toBe(1);
  });
});

describe("content and scope change boundary", () => {
  it.each<[string, ActionEnvelope]>([
    [
      "body",
      {
        ...FILE_ACTION,
        canonicalArgs: { path: "canary.txt", content: "materially changed body" },
      },
    ],
    ["target", { ...FILE_ACTION, target: "other.txt" }],
    ["recipient", { ...FILE_ACTION, recipients: ["team:outside"] }],
    ["scope", { ...FILE_ACTION, workingDirectory: "/other-workspace" }],
  ])("invalidates the old approval when the %s changes", async (_label, changedAction) => {
    expect(approveStored().request.state).toBe("approved");
    const result = await executeFile(changedAction);

    expect(result.status).toBe("blocked");
    expect(result.code).toBe("approval_invalid");
    expect(stored.request.state).toBe("invalidated");
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });

  it("still executes the unchanged positive control exactly once after a rejected change", async () => {
    expect(approveStored().request.state).toBe("approved");
    const changed = await executeFile({
      ...FILE_ACTION,
      target: "other.txt",
    });
    expect(changed.status).toBe("blocked");

    // A fresh approval for the original action must work, proving the boundary
    // is not simply unable to execute any tool.
    stored = pendingFor(FILE_ACTION);
    expect(approveStored().request.state).toBe("approved");
    const positive = await executeFile();
    expect(positive.status).toBe("succeeded");
    expect(fileWrites).toBe(1);
  });
});

describe("single execution and lost-response boundary", () => {
  it("executes an approved unchanged action exactly once", async () => {
    expect(approveStored().request.state).toBe("approved");
    const first = await executeFile();

    expect(first.status).toBe("succeeded");
    expect(fileWrites).toBe(1);
    expect(await hashCanary()).not.toBe(BEFORE_HASH);
    expect(first.receipts.map((receipt) => receipt.kind)).toEqual(
      expect.arrayContaining(["tool_execution_entered", "tool_finalized"]),
    );
    expect(stored.permit?.consumedAt).toBeTruthy();

    const second = await executeFile();
    expect(second.status).toBe("blocked");
    expect(second.code).toBe("already_consumed");
    expect(fileWrites).toBe(1);
  });

  it("reports outcome_unknown when the response is lost after a committed side effect", async () => {
    stored = pendingFor(EXTERNAL_ACTION);
    expect(approveStored().request.state).toBe("approved");
    const lost = await executeWith(
      async () => {
        externalCalls += 1;
        return { accepted: true };
      },
      EXTERNAL_ACTION,
      { simulateResponseLoss: true },
    );

    expect(lost.status).toBe("outcome_unknown");
    expect(externalCalls).toBe(1);

    const retry = await executeExternal();
    expect(retry.status).toBe("blocked");
    expect(["already_consumed", "outcome_unknown"]).toContain(retry.code);
    expect(externalCalls).toBe(1);
  });

  it("reports outcome_unknown when a side effect happened but the tool never returned", async () => {
    stored = pendingFor(EXTERNAL_ACTION);
    expect(approveStored().request.state).toBe("approved");
    const lost = await executeWith(async () => {
      externalCalls += 1;
      throw new Error("worker died after the external call");
    }, EXTERNAL_ACTION);

    expect(lost.status).toBe("outcome_unknown");
    expect(externalCalls).toBe(1);

    const retry = await executeExternal();
    expect(retry.status).toBe("blocked");
    expect(externalCalls).toBe(1);
  });

  it("refuses an approved permit while the run is stopping", async () => {
    expect(approveStored().request.state).toBe("approved");
    const result = await executeWith(
      async () => {
        fileWrites += 1;
        await writeFile(canaryPath, "should not happen", "utf8");
        return { wrote: true };
      },
      FILE_ACTION,
      { runState: "stopping" },
    );

    expect(result.status).toBe("blocked");
    expect(result.code).toBe("run_stopping");
    expect(fileWrites).toBe(0);
    expect(await hashCanary()).toBe(BEFORE_HASH);
  });
});
