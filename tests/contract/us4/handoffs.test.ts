/**
 * US4 / T128 - handoff invitation, preparation, refresh, accept/reject and
 * operator-takeover contract tests.
 *
 * Contract sources:
 * - specs/001-agent-federated-collaboration/contracts/runner-api.openapi.yaml
 * - specs/001-agent-federated-collaboration/contracts/realtime-events.md
 * - specs/001-agent-federated-collaboration/data-model.md section 6
 * - specs/001-agent-federated-collaboration/quickstart.md QS-04
 * - specs/001-agent-federated-collaboration/uat-catalog.md UAT-08, TO-03
 *
 * These are intentionally red tests. On a spec-only checkout Vitest and the
 * Runner API do not exist yet; every helper below fails with a message naming
 * the missing dependency instead of passing vacuously.
 *
 * Required fixture (provided by the US4 validation harness):
 * - a shared workspace with one active long-running Run;
 * - an operator, a recipient who is an eligible workspace member, and an owner;
 * - bearer sessions for all three.
 */
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const API_BASE = (process.env.UNSPOOL_BASE_URL ?? "http://127.0.0.1:8787/v1").replace(/\/+$/, "");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOKEN_ENV = {
  operator: "US4_OPERATOR_TOKEN",
  recipient: "US4_RECIPIENT_TOKEN",
  owner: "US4_OWNER_TOKEN",
} as const;
type Role = keyof typeof TOKEN_ENV;

const FIXTURE_ENV = [
  "US4_WORKSPACE_ID",
  "US4_RUN_ID",
  "US4_OPERATOR_ID",
  "US4_RECIPIENT_ID",
  "US4_OWNER_ID",
  "US4_MAIN_CONVERSATION_ID",
  "US4_OPERATOR_TOKEN",
  "US4_RECIPIENT_TOKEN",
  "US4_OWNER_TOKEN",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing US4 contract fixture: ${name}. Seed the running-handoff workspace described in ` +
        `tests/contract/us4/handoffs.test.ts; this test must stay red until that fixture exists.`,
    );
  }
  return value;
}

const workspaceId = () => requireEnv("US4_WORKSPACE_ID");
const runId = () => requireEnv("US4_RUN_ID");
const operatorId = () => requireEnv("US4_OPERATOR_ID");
const recipientId = () => requireEnv("US4_RECIPIENT_ID");
const ownerId = () => requireEnv("US4_OWNER_ID");

function assertFixture(): void {
  for (const name of FIXTURE_ENV) requireEnv(name);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
}

function commandBody(payload: Record<string, unknown>, commandId = randomUUID()) {
  const payloadDigest = `sha256:${createHash("sha256").update(canonicalize(payload)).digest("hex")}`;
  return { schemaVersion: 1, commandId, payloadDigest, ...payload };
}

type CallOptions = {
  role?: Role;
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: number;
};

async function call(path: string, options: CallOptions = {}) {
  const role = options.role ?? "operator";
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${requireEnv(TOKEN_ENV[role])}`,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = options.idempotencyKey ?? randomUUID();
  if (options.ifMatch !== undefined) headers["if-match"] = `"${options.ifMatch}"`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      `Missing US4 contract behavior: Runner API is unreachable at ${API_BASE} (${String(error)}). ` +
        `Implement T139-T144 and start the validation Runner; the test intentionally fails until then.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let body: any;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, headers: response.headers, body, text };
}

function expectJsonObject(result: Awaited<ReturnType<typeof call>>, status: number) {
  expect(result.status, result.text).toBe(status);
  expect(result.headers.get("content-type") ?? "").toContain("application/json");
  expect(result.body).toBeTypeOf("object");
  expect(result.body).not.toBeNull();
  return result.body;
}

function expectProblem(result: Awaited<ReturnType<typeof call>>, status: number, code: string) {
  expect(result.status, result.text).toBe(status);
  expect(result.headers.get("content-type") ?? "").toContain("application/problem+json");
  expect(result.body.code).toBe(code);
  expect(result.body.detail).toBeTypeOf("string");
  expect(result.body.detail).not.toMatch(/at\s+\S+:\d+:\d+/);
  return result.body;
}

async function getWorkspace() {
  return expectJsonObject(await call(`/workspaces/${workspaceId()}`, { role: "operator" }), 200);
}

async function getRun() {
  return expectJsonObject(
    await call(`/workspaces/${workspaceId()}/runs/${runId()}`, { role: "operator" }),
    200,
  );
}

async function invite(recipient: string, reason: string) {
  const idempotencyKey = randomUUID();
  const body = commandBody({ recipientId: recipient, reason });
  const result = await call(`/workspaces/${workspaceId()}/handoffs`, {
    role: "operator",
    body,
    idempotencyKey,
  });
  const invitation = expectJsonObject(result, 201);
  expect(invitation.id).toMatch(UUID_RE);
  return { id: String(invitation.id), idempotencyKey, body, invitation, result };
}

let baselineWorkspace: any;
let baselineRun: any;
let acceptInvite: Awaited<ReturnType<typeof invite>>;
let preparation: any;
let refresh: any;

describe("US4 handoff API contract", () => {
  beforeAll(async () => {
    assertFixture();
    baselineWorkspace = await getWorkspace();
    baselineRun = await getRun();
    expect(baselineRun.id).toBe(runId());
    expect(baselineRun.state, "the US4 fixture must contain a live Run").toBe("running");
    expect(baselineWorkspace.currentOperator.operatorId).toBe(operatorId());
    acceptInvite = await invite(recipientId(), "US4 contract accept path");
  });

  it("[UAT-08][TO-03] creates an invitation without stopping or restarting the active Run", async () => {
    const invitation = acceptInvite.invitation;
    expect(invitation.workspaceId).toBe(workspaceId());
    expect(invitation.fromOperatorId).toBe(operatorId());
    expect(invitation.recipientId).toBe(recipientId());
    expect(invitation.status).toBe("invited");
    expect(invitation.baseRevision).toBe(baselineWorkspace.revision);
    expect(invitation.summarySnapshotId).toMatch(UUID_RE);
    expect(Date.parse(invitation.createdAt)).not.toBeNaN();

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(baselineRun.operatorEpoch);

    const afterWorkspace = await getWorkspace();
    expect(afterWorkspace.currentOperator).toEqual(baselineWorkspace.currentOperator);

    const replay = await call(`/workspaces/${workspaceId()}/handoffs`, {
      role: "operator",
      body: acceptInvite.body,
      idempotencyKey: acceptInvite.idempotencyKey,
    });
    expectJsonObject(replay, 201);
    expect(replay.body.id).toBe(acceptInvite.id);

    const conflictingReplay = await call(`/workspaces/${workspaceId()}/handoffs`, {
      role: "operator",
      body: commandBody({ recipientId: ownerId(), reason: "different payload" }),
      idempotencyKey: acceptInvite.idempotencyKey,
    });
    expectProblem(conflictingReplay, 409, "revision_conflict");
  });

  it("[UAT-08][FR-035] starts an isolated read-only preparation with a complete immutable summary", async () => {
    const result = await call(`/workspaces/${workspaceId()}/handoffs/${acceptInvite.id}/prepare`, {
      role: "recipient",
      body: commandBody({}),
    });
    preparation = expectJsonObject(result, 201);

    expect(preparation.handoffId).toBe(acceptInvite.id);
    expect(preparation.recipientId).toBe(recipientId());
    expect(preparation.status).toBe("preparing");
    expect(preparation.readOnlyConversationId).toMatch(UUID_RE);
    expect(preparation.readOnlyConversationId).not.toBe(requireEnv("US4_MAIN_CONVERSATION_ID"));
    expect(Date.parse(preparation.startedAt)).not.toBeNaN();
    expect(preparation.asOfRevision).toBeTypeOf("number");
    expect(preparation.latestRevision).toBeGreaterThanOrEqual(preparation.asOfRevision);

    const summary = preparation.summary ?? preparation.handoffSummary;
    expect(summary, "prepare must return the immutable HandoffSummary").toBeTruthy();
    expect(summary.revision).toBeTypeOf("number");
    expect(preparation.asOfRevision).toBeGreaterThanOrEqual(summary.revision);
    expect(summary.goal).toBe(baselineWorkspace.goal);
    expect(summary.criteria).toBe(baselineWorkspace.completionCriteria);
    expect(summary.runState).toBe(baselineRun.state);
    for (const field of [
      "decisions",
      "completedWork",
      "pendingApprovalIds",
      "queueIds",
      "todoIds",
      "artifactIds",
      "blockers",
      "grantIds",
    ]) {
      expect(Array.isArray(summary[field]), `summary.${field} must be an array`).toBe(true);
    }

    const denied = await call(`/workspaces/${workspaceId()}/handoffs/${acceptInvite.id}/prepare`, {
      role: "owner",
      body: commandBody({}),
    });
    expectProblem(denied, 403, "permission_denied");

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(baselineRun.operatorEpoch);
  });

  it("[UAT-23] refreshes background state and reports the latest recorded time", async () => {
    const result = await call(`/workspaces/${workspaceId()}/handoffs/${acceptInvite.id}/refresh`, {
      role: "recipient",
      body: commandBody({}),
    });
    refresh = expectJsonObject(result, 200);

    expect(refresh.latestRevision).toBeGreaterThanOrEqual(preparation.latestRevision);
    const recordedAt = refresh.refreshedAt ?? refresh.latestRecordedAt;
    expect(Date.parse(recordedAt), "refresh must expose the latest recorded time").not.toBeNaN();
    expect(
      Array.isArray(refresh.unresolvedIssues ?? []),
      "refresh must expose unresolved issues",
    ).toBe(true);

    const denied = await call(`/workspaces/${workspaceId()}/handoffs/${acceptInvite.id}/refresh`, {
      role: "owner",
      body: commandBody({}),
    });
    expectProblem(denied, 403, "permission_denied");
  });

  it("[UAT-08][FR-035] rejects only for the invited recipient and leaves the Run untouched", async () => {
    const rejectInvite = await invite(ownerId(), "US4 contract reject path");

    const wrongRecipient = await call(
      `/workspaces/${workspaceId()}/handoffs/${rejectInvite.id}/reject`,
      { role: "recipient", body: commandBody({ reason: "not my invitation" }) },
    );
    expectProblem(wrongRecipient, 403, "permission_denied");

    const rejectionReason = `US4 reject ${randomUUID()}`;
    const result = await call(`/workspaces/${workspaceId()}/handoffs/${rejectInvite.id}/reject`, {
      role: "owner",
      body: commandBody({ reason: rejectionReason }),
    });
    const rejected = expectJsonObject(result, 200);
    expect(rejected.id).toBe(rejectInvite.id);
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe(rejectionReason);

    expect((await getRun()).state).toBe("running");
    expect((await getWorkspace()).currentOperator).toEqual(baselineWorkspace.currentOperator);
  });

  it("[UAT-08][TO-03] requires a fresh revision and transfers only the operator epoch on accept", async () => {
    expect(preparation.asOfRevision).toBeGreaterThan(0);

    const stale = await call(`/workspaces/${workspaceId()}/handoffs/${acceptInvite.id}/accept`, {
      role: "recipient",
      body: commandBody({}),
      ifMatch: preparation.asOfRevision - 1,
    });
    expectProblem(stale, 409, "revision_conflict");
    expect((await getWorkspace()).currentOperator).toEqual(baselineWorkspace.currentOperator);

    const result = await call(`/workspaces/${workspaceId()}/handoffs/${acceptInvite.id}/accept`, {
      role: "recipient",
      body: commandBody({}),
      ifMatch: preparation.latestRevision,
    });
    const accepted = expectJsonObject(result, 200);
    expect(accepted.id).toBe(acceptInvite.id);
    expect(accepted.status).toBe("accepted");
    expect(Date.parse(accepted.acceptedAt)).not.toBeNaN();

    const afterWorkspace = await getWorkspace();
    expect(afterWorkspace.currentOperator.operatorId).toBe(recipientId());
    expect(afterWorkspace.currentOperator.operatorEpoch).toBe(
      baselineWorkspace.currentOperator.operatorEpoch + 1,
    );

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(afterWorkspace.currentOperator.operatorEpoch);

    const oldOperatorControl = await call(`/workspaces/${workspaceId()}/runs/${runId()}/steer`, {
      role: "operator",
      body: commandBody({ operatorEpoch: baselineRun.operatorEpoch, body: "stale control" }),
    });
    expectProblem(oldOperatorControl, 409, "operator_changed");

    const newOperatorControl = await call(
      `/workspaces/${workspaceId()}/runs/${runId()}/follow-ups`,
      {
        role: "recipient",
        body: commandBody({
          operatorEpoch: afterWorkspace.currentOperator.operatorEpoch,
          body: "US4 post-accept follow-up",
        }),
      },
    );
    expectJsonObject(newOperatorControl, 202);
  });

  it("[UAT-09][TO-03] requires a reason for forced takeover and rejects stale epochs", async () => {
    const beforeWorkspace = await getWorkspace();
    const beforeRun = await getRun();
    const epoch = beforeWorkspace.currentOperator.operatorEpoch;

    const missingReason = await call(`/workspaces/${workspaceId()}/operator-takeover`, {
      role: "owner",
      body: commandBody({ kind: "forced", operatorEpoch: epoch }),
      ifMatch: beforeWorkspace.revision,
    });
    expectProblem(missingReason, 400, "invalid_request");

    const blankReason = await call(`/workspaces/${workspaceId()}/operator-takeover`, {
      role: "owner",
      body: commandBody({ kind: "forced", operatorEpoch: epoch, reason: "   " }),
      ifMatch: beforeWorkspace.revision,
    });
    expectProblem(blankReason, 400, "invalid_request");

    const nonOwnerForced = await call(`/workspaces/${workspaceId()}/operator-takeover`, {
      role: "operator",
      body: commandBody({ kind: "forced", operatorEpoch: epoch, reason: "not an owner" }),
      ifMatch: beforeWorkspace.revision,
    });
    expectProblem(nonOwnerForced, 403, "permission_denied");

    const staleEpoch = await call(`/workspaces/${workspaceId()}/operator-takeover`, {
      role: "owner",
      body: commandBody({ kind: "forced", operatorEpoch: epoch - 1, reason: "stale" }),
      ifMatch: beforeWorkspace.revision,
    });
    expectProblem(staleEpoch, 409, "operator_changed");
    expect((await getWorkspace()).currentOperator.operatorId).toBe(recipientId());

    const reason = `US4 forced takeover ${randomUUID()}`;
    const result = await call(`/workspaces/${workspaceId()}/operator-takeover`, {
      role: "owner",
      body: commandBody({ kind: "forced", operatorEpoch: epoch, reason }),
      ifMatch: beforeWorkspace.revision,
    });
    expectJsonObject(result, 200);

    const afterWorkspace = await getWorkspace();
    expect(afterWorkspace.currentOperator.operatorId).toBe(ownerId());
    expect(afterWorkspace.currentOperator.operatorEpoch).toBe(epoch + 1);

    const afterRun = await getRun();
    expect(afterRun.id).toBe(beforeRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(epoch + 1);

    const staleStop = await call(`/workspaces/${workspaceId()}/runs/${runId()}/stop`, {
      role: "recipient",
      body: commandBody({ operatorEpoch: epoch, confirmedStop: true, body: "stale stop" }),
    });
    expectProblem(staleStop, 409, "operator_changed");
  });
});
