import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const REQUESTER = "user-requester";
const APPROVER = "user-approver";
const ADMIN = "user-admin";
const ATTEMPT = "attempt-1";
const POLICY_REVISION = 1;
const NOW = new Date("2026-11-22T10:00:00.000Z");
const CANARY = "canary-token-never-visible";

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(existsSyncSafe(absolute), `US1 approval implementation is missing: ${relativePath}`);
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

function existsSyncSafe(path: string): boolean {
  try {
    return Boolean(readFileSync(path));
  } catch {
    return false;
  }
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function action(filePath: string) {
  return {
    toolName: "write_file",
    canonicalArgs: { path: filePath, content: "new body", token: CANARY },
    workingDirectory: "/workspace",
    target: filePath,
    recipients: ["workspace:unspool"],
    baseResourceVersions: [{ id: filePath, version: "1" }],
  };
}

async function createPending(service: Record<string, any>, filePath: string) {
  return service.createApprovalRequest({
    id: "request-1",
    actionProposalId: "proposal-1",
    requesterId: REQUESTER,
    action: action(filePath),
    purpose: "Write one reviewed report",
    impact: "Overwrite exactly one report file",
    risk: "high",
    displayArgs: { path: filePath, content: "new body", token: "<secret-ref:env/REPORT_TOKEN>" },
    secretRefs: ["env/REPORT_TOKEN"],
    policyRevision: POLICY_REVISION,
    now: NOW,
  });
}

async function decide(
  service: Record<string, any>,
  created: any,
  actorId: string,
  decision = "approved",
  allowSelf = false,
) {
  return service.decideApproval({
    request: created.request,
    proposal: created.proposal,
    actorId,
    decision,
    actionDigest: created.proposal.actionDigest,
    reason: decision === "rejected" ? "The report must not be overwritten." : undefined,
    now: NOW,
    approverPolicy: { approverIds: [APPROVER], allowRequesterSelfApproval: allowSelf },
  });
}

async function issue(service: Record<string, any>, decided: any) {
  return service.issueExecutionPermit({
    id: "permit-1",
    request: decided.request,
    proposal: decided.proposal,
    decision: decided.decision,
    runAttemptId: ATTEMPT,
    policyRevision: POLICY_REVISION,
    now: NOW,
  });
}

test("rejection leaves the target file and external counter untouched", async () => {
  const service = await loadModule("apps/runner-api/src/approvals/service.ts");
  const directory = mkdtempSync(join(tmpdir(), "unspool-approval-reject-"));
  const filePath = join(directory, "report.md");
  writeFileSync(filePath, "original", "utf8");
  const before = digest(readFileSync(filePath));
  const externalCount = 0;
  const created = await createPending(service, filePath);
  const rejected = await decide(service, created, APPROVER, "rejected");

  assert.equal(rejected.request.state, "rejected");
  assert.equal(rejected.error?.code, "approval_invalid");
  assert.equal(digest(readFileSync(filePath)), before);
  assert.equal(externalCount, 0);
  assert.equal(rejected.decision.reason, "The report must not be overwritten.");
});

test("approval executes once and a second permit consumption cannot repeat the side effect", async () => {
  const service = await loadModule("apps/runner-api/src/approvals/service.ts");
  const gate = await loadModule("packages/pi-adapter/src/approval-gate.ts");
  const directory = mkdtempSync(join(tmpdir(), "unspool-approval-execute-"));
  const filePath = join(directory, "report.md");
  writeFileSync(filePath, "original", "utf8");
  let externalCount = 0;
  const created = await createPending(service, filePath);
  const approved = await decide(service, created, APPROVER, "approved");
  const issued = await issue(service, approved);

  const first = await gate.executeWithApproval({
    permit: issued.permit,
    actionDigest: issued.permit.actionDigest,
    runAttemptId: ATTEMPT,
    policyRevision: POLICY_REVISION,
    execute: async () => {
      writeFileSync(filePath, "new body", "utf8");
      externalCount += 1;
    },
  });
  assert.equal(first.status, "consumed");
  assert.equal(externalCount, 1);
  assert.equal(readFileSync(filePath, "utf8"), "new body");

  await assert.rejects(
    gate.executeWithApproval({
      permit: issued.permit,
      actionDigest: issued.permit.actionDigest,
      runAttemptId: ATTEMPT,
      policyRevision: POLICY_REVISION,
      execute: async () => {
        writeFileSync(filePath, "second body", "utf8");
        externalCount += 1;
      },
    }),
    /consumed|invalid/i,
  );
  assert.equal(externalCount, 1);
  assert.equal(readFileSync(filePath, "utf8"), "new body");
});

test("default self-approval is denied while the explicit single-user exception is auditable", async () => {
  const service = await loadModule("apps/runner-api/src/approvals/service.ts");
  const filePath = join(mkdtempSync(join(tmpdir(), "unspool-self-")), "report.md");
  const created = await createPending(service, filePath);
  const denied = await decide(service, created, REQUESTER, "approved");
  assert.equal(denied.error?.code, "self_approval_not_allowed");

  const allowed = await decide(service, created, REQUESTER, "approved", true);
  assert.notEqual(allowed.error?.code, "self_approval_not_allowed");
  assert.equal(allowed.audit.singleUserException, true);
  assert.equal(allowed.audit.approverId, REQUESTER);
});

test("secret canary stays in controlled canonical args and changes the action digest", async () => {
  const service = await loadModule("apps/runner-api/src/approvals/service.ts");
  const filePath = join(mkdtempSync(join(tmpdir(), "unspool-secret-")), "report.md");
  const created = await createPending(service, filePath);
  const approved = await decide(service, created, APPROVER, "approved");
  const publicView = JSON.stringify({
    displayArgs: created.proposal.displayArgs,
    decision: approved.decision,
    audit: approved.audit,
    errors: [approved.error],
  });
  assert.equal(publicView.includes(CANARY), false);
  assert.deepEqual(created.proposal.secretRefs, ["env/REPORT_TOKEN"]);

  const changed = service.computeActionDigest({
    ...action(filePath),
    canonicalArgs: { ...action(filePath).canonicalArgs, token: "different-secret" },
  });
  assert.notEqual(changed, created.proposal.actionDigest);
});
