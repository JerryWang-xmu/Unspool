/**
 * US4 / T130 - background revision, concurrent takeover, offline eligibility
 * and forced-takeover reason tests.
 *
 * Contract sources:
 * - specs/001-agent-federated-collaboration/spec.md US4 scenario 6
 * - specs/001-agent-federated-collaboration/data-model.md WorkspaceControl/Run
 * - specs/001-agent-federated-collaboration/quickstart.md QS-02.5, QS-04.4
 * - specs/001-agent-federated-collaboration/uat-catalog.md UAT-09, TO-03
 *
 * These tests are intentionally red before T140 exists. The controlled-clock
 * endpoint is a test-support dependency, not a production API:
 *
 *   POST ${US4_TEST_CLOCK_URL} { "advanceMs": <integer> }
 *
 * Required fixture: a shared workspace with a live Run and an idle workspace
 * with no active Run, plus operator/recipient/second-operator/owner sessions.
 */
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const API_BASE = (process.env.UNSPOOL_BASE_URL ?? "http://127.0.0.1:8787/v1").replace(/\/+$/, "");
const ACTIVE_RUN_STATES = new Set(["created", "running", "waiting_approval", "stopping"]);

const TOKEN_ENV = {
  operator: "US4_OPERATOR_TOKEN",
  recipient: "US4_RECIPIENT_TOKEN",
  second_operator: "US4_SECOND_OPERATOR_TOKEN",
  owner: "US4_OWNER_TOKEN",
} as const;
type Role = keyof typeof TOKEN_ENV;

const FIXTURE_ENV = [
  "US4_WORKSPACE_ID",
  "US4_RUN_ID",
  "US4_IDLE_WORKSPACE_ID",
  "US4_OPERATOR_ID",
  "US4_RECIPIENT_ID",
  "US4_SECOND_OPERATOR_ID",
  "US4_OWNER_ID",
  "US4_OPERATOR_TOKEN",
  "US4_RECIPIENT_TOKEN",
  "US4_SECOND_OPERATOR_TOKEN",
  "US4_OWNER_TOKEN",
  "US4_TEST_CLOCK_URL",
  "US4_LONG_TASK_PROMPT",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing US4 operator-epoch fixture: ${name}. Seed the takeover workspaces described in ` +
        `tests/integration/us4/operator-epoch.test.ts; this test must stay red until then.`,
    );
  }
  return value;
}

const workspaceId = () => requireEnv("US4_WORKSPACE_ID");
const idleWorkspaceId = () => requireEnv("US4_IDLE_WORKSPACE_ID");
const runId = () => requireEnv("US4_RUN_ID");
const operatorId = () => requireEnv("US4_OPERATOR_ID");
const recipientId = () => requireEnv("US4_RECIPIENT_ID");
const secondOperatorId = () => requireEnv("US4_SECOND_OPERATOR_ID");
const ownerId = () => requireEnv("US4_OWNER_ID");

function assertFixture(): void {
  for (const name of FIXTURE_ENV) requireEnv(name);
  expect(new Set([operatorId(), recipientId(), secondOperatorId(), ownerId()]).size).toBe(4);
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
      `Missing US4 operator-epoch behavior: Runner API is unreachable at ${API_BASE} ` +
        `(${String(error)}). Implement T139-T144 and start the validation Runner.`,
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
  return result.body;
}

function listItems(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data)) return body.data;
  throw new Error("Missing US4 behavior: list endpoints must return an array or { items: [] }");
}

async function getWorkspace(role: Role = "operator", id = workspaceId()) {
  return expectJsonObject(await call(`/workspaces/${id}`, { role }), 200);
}

async function getRun(role: Role = "operator") {
  return expectJsonObject(
    await call(`/workspaces/${workspaceId()}/runs/${runId()}`, { role }),
    200,
  );
}

async function listRuns(role: Role, id: string) {
  return listItems(expectJsonObject(await call(`/workspaces/${id}/runs`, { role }), 200));
}

function parseSse(text: string): any[] {
  const events: any[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Heartbeats are not DomainEvents.
    }
  }
  return events;
}

async function collectEvents(role: Role, after: number, settleMs = 350): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settleMs);
  let text = "";
  try {
    const response = await fetch(`${API_BASE}/workspaces/${workspaceId()}/events?after=${after}`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${requireEnv(TOKEN_ENV[role])}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Missing US4 event-stream behavior: GET events returned ${response.status} ${await response.text()}`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing US4 event-stream behavior: empty response body");
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (error instanceof Error && error.message.startsWith("Missing US4")) throw error;
      throw new Error(
        `Missing US4 event-stream behavior at ${API_BASE}/workspaces/${workspaceId()}/events ` +
          `(${String(error)}). Implement T039/T144.`,
      );
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return parseSse(text);
}

function latestSequence(events: any[]): number {
  return events.reduce(
    (max, event) =>
      Number.isInteger(event?.sequence) ? Math.max(max, Number(event.sequence)) : max,
    0,
  );
}

async function waitForEvent(
  role: Role,
  after: number,
  predicate: (event: any) => boolean,
  timeoutMs = 3_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await collectEvents(role, after, 250);
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Missing US4 behavior: expected DomainEvent did not arrive for ${role} after sequence ${after}.`,
  );
}

async function advanceClock(ms: number): Promise<void> {
  const url = requireEnv("US4_TEST_CLOCK_URL");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ advanceMs: ms }),
    });
  } catch (error) {
    throw new Error(
      `Missing US4 controlled-clock fixture at ${url} (${String(error)}). ` +
        `Offline-2-minute tests cannot use wall-clock sleeps.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Missing US4 controlled-clock behavior: POST ${url} returned ${response.status} ` +
        `${await response.text()}`,
    );
  }
}

async function markOnline(role: Role): Promise<void> {
  // Presence is updated by authenticated activity and by an authenticated SSE
  // subscription. The test-support harness must treat both as lastSeenAt.
  await call("/me", { role });
  await collectEvents(role, 0, 150);
}

async function takeover(
  role: Role,
  kind: "offline" | "forced",
  reason: string | undefined,
  operatorEpoch: number,
  ifMatch: number,
) {
  const payload: Record<string, unknown> = { kind, operatorEpoch };
  if (reason !== undefined) payload.reason = reason;
  return call(`/workspaces/${workspaceId()}/operator-takeover`, {
    role,
    body: commandBody(payload),
    ifMatch,
  });
}

async function startRun(id: string, role: Role, operatorEpoch: number, body: string) {
  return call(`/workspaces/${id}/runs`, {
    role,
    body: commandBody({ operatorEpoch, body }),
  });
}

async function controlRun(
  role: Role,
  action: "steer" | "follow-ups" | "stop",
  operatorEpoch: number,
  extra: Record<string, unknown> = {},
) {
  return call(`/workspaces/${workspaceId()}/runs/${runId()}/${action}`, {
    role,
    body: commandBody({ operatorEpoch, ...extra }),
  });
}

let baselineWorkspace: any;
let baselineRun: any;
let baselineSequence = 0;
let offlineEpoch = 0;
let concurrentEpoch = 0;
let concurrentWinnerRole: Role | undefined;
let concurrentWinnerId = "";
let concurrentLoserRole: Role | undefined;
let concurrentLoserEpoch = 0;

describe("US4 operator epoch and takeover", () => {
  beforeAll(async () => {
    assertFixture();
    baselineWorkspace = await getWorkspace();
    baselineRun = await getRun();
    expect(baselineRun.state, "the US4 fixture must contain a live Run").toBe("running");
    expect(baselineWorkspace.currentOperator.operatorId).toBe(operatorId());

    const idle = await getWorkspace("operator", idleWorkspaceId());
    expect(idle.currentOperator.operatorId).toBe(operatorId());
    expect(idle.currentOperator.operatorEpoch).toBeGreaterThan(0);

    baselineSequence = latestSequence(await collectEvents("operator", 0, 500));
    await markOnline("operator");
  });

  it("[TO-03][QS-02.5] creates only one active Run under concurrent starts", async () => {
    const idle = await getWorkspace("operator", idleWorkspaceId());
    const runsBefore = new Set(
      (await listRuns("operator", idleWorkspaceId())).map((run) => run.id),
    );
    const epoch = idle.currentOperator.operatorEpoch;

    const attempts = await Promise.all([
      startRun(idleWorkspaceId(), "operator", epoch, requireEnv("US4_LONG_TASK_PROMPT")),
      startRun(idleWorkspaceId(), "operator", epoch, requireEnv("US4_LONG_TASK_PROMPT")),
    ]);

    const accepted = attempts.filter((attempt) => attempt.status === 202);
    const rejected = attempts.filter((attempt) => attempt.status !== 202);
    expect(accepted, JSON.stringify(attempts.map((attempt) => attempt.text))).toHaveLength(1);
    expect(rejected, JSON.stringify(attempts.map((attempt) => attempt.text))).toHaveLength(1);
    expectProblem(rejected[0], 409, "task_active");

    const winner = expectJsonObject(accepted[0], 202);
    expect(winner.id).toBeTypeOf("string");

    const newRuns = (await listRuns("operator", idleWorkspaceId())).filter(
      (run) => !runsBefore.has(run.id),
    );
    expect(newRuns, "concurrent starts must create exactly one Run").toHaveLength(1);
    expect(newRuns[0].id).toBe(winner.id);

    const fetched = expectJsonObject(
      await call(`/workspaces/${idleWorkspaceId()}/runs/${winner.id}`, { role: "operator" }),
      200,
    );
    expect(ACTIVE_RUN_STATES.has(fetched.state)).toBe(true);

    const mainRun = await getRun();
    expect(mainRun.id).toBe(baselineRun.id);
    expect(mainRun.state).toBe("running");
  });

  it("[UAT-09][FR-036] rejects offline takeover while the operator is still present", async () => {
    await markOnline("operator");
    const before = await getWorkspace();

    const result = await takeover(
      "recipient",
      "offline",
      undefined,
      before.currentOperator.operatorEpoch,
      before.revision,
    );
    // The contract has no dedicated "operator still online" problem code yet.
    // Any 4xx is a rejection; the invariant below is the observable contract.
    expect([403, 409], result.text).toContain(result.status);
    expect(result.headers.get("content-type") ?? "").toContain("application/problem+json");
    expect(result.body.code).toBeTypeOf("string");

    const after = await getWorkspace();
    expect(after.currentOperator).toEqual(before.currentOperator);
    expect((await getRun()).state).toBe("running");
  });

  it("[UAT-09][FR-036] allows offline takeover only after more than two minutes", async () => {
    const online = await getWorkspace();
    await markOnline("operator");
    await advanceClock(119_000);

    const tooEarly = await takeover(
      "recipient",
      "offline",
      undefined,
      online.currentOperator.operatorEpoch,
      online.revision,
    );
    expect([403, 409], tooEarly.text).toContain(tooEarly.status);
    expect((await getWorkspace()).currentOperator).toEqual(online.currentOperator);

    await advanceClock(2_000);
    const before = await getWorkspace();
    const accepted = await takeover(
      "recipient",
      "offline",
      undefined,
      before.currentOperator.operatorEpoch,
      before.revision,
    );
    const control = expectJsonObject(accepted, 200);
    const after = await getWorkspace();

    expect(after.currentOperator.operatorId).toBe(recipientId());
    expect(after.currentOperator.operatorEpoch).toBe(before.currentOperator.operatorEpoch + 1);
    offlineEpoch = after.currentOperator.operatorEpoch;
    expect(control.operatorEpoch ?? offlineEpoch).toBe(offlineEpoch);

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(offlineEpoch);

    const event = await waitForEvent(
      "operator",
      baselineSequence,
      (candidate) =>
        candidate.type === "handoff.takeover" &&
        JSON.stringify(candidate).includes(String(offlineEpoch)),
    );
    expect(JSON.stringify(event)).toMatch(/offline/i);
  });

  it("[TO-03][FR-036] lets exactly one of two concurrent offline applicants take over", async () => {
    await markOnline("recipient");
    await advanceClock(121_000);

    const before = await getWorkspace();
    const epoch = before.currentOperator.operatorEpoch;
    const revision = before.revision;

    const [first, second] = await Promise.all([
      takeover("operator", "offline", undefined, epoch, revision),
      takeover("second_operator", "offline", undefined, epoch, revision),
    ]);

    const successes = [
      { role: "operator" as Role, result: first, id: operatorId() },
      { role: "second_operator" as Role, result: second, id: secondOperatorId() },
    ].filter((attempt) => attempt.result.status === 200);
    const failures = [
      { role: "operator" as Role, result: first, id: operatorId() },
      { role: "second_operator" as Role, result: second, id: secondOperatorId() },
    ].filter((attempt) => attempt.result.status !== 200);

    expect(successes, JSON.stringify([first.text, second.text])).toHaveLength(1);
    expect(failures, JSON.stringify([first.text, second.text])).toHaveLength(1);
    expectProblem(failures[0].result, 409, "operator_changed");

    concurrentWinnerRole = successes[0].role;
    concurrentWinnerId = successes[0].id;
    concurrentLoserRole = failures[0].role;
    concurrentLoserEpoch = epoch;

    const after = await getWorkspace();
    expect(after.currentOperator.operatorId).toBe(concurrentWinnerId);
    expect(after.currentOperator.operatorEpoch).toBe(epoch + 1);
    concurrentEpoch = after.currentOperator.operatorEpoch;

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(concurrentEpoch);

    const takeoverEvents = (await collectEvents("operator", baselineSequence, 700)).filter(
      (event) =>
        event.type === "handoff.takeover" && event.payload?.operatorEpoch === concurrentEpoch,
    );
    expect(takeoverEvents, "only one takeover may be committed for one epoch").toHaveLength(1);
  });

  it("[TO-03][UAT-09] gives a reconnected old operator no control and preserves discussion rights", async () => {
    expect(concurrentWinnerRole, "depends on the concurrent-takeover step").toBeTruthy();
    expect(concurrentLoserRole, "depends on the concurrent-takeover step").toBeTruthy();

    const staleStop = await controlRun(concurrentLoserRole!, "stop", concurrentLoserEpoch, {
      confirmedStop: true,
      body: "US4 stale stop after takeover",
    });
    expectProblem(staleStop, 409, "operator_changed");

    const staleSteer = await controlRun(concurrentLoserRole!, "steer", concurrentLoserEpoch, {
      body: "US4 stale steer after takeover",
    });
    expectProblem(staleSteer, 409, "operator_changed");

    const staleFollowUp = await controlRun(
      concurrentLoserRole!,
      "follow-ups",
      concurrentLoserEpoch,
      {
        body: "US4 stale follow-up after takeover",
      },
    );
    expectProblem(staleFollowUp, 409, "operator_changed");

    const current = await getWorkspace(concurrentLoserRole!);
    expect(current.currentOperator.operatorId).toBe(concurrentWinnerId);
    expect(current.currentOperator.operatorId).not.toBe(
      concurrentLoserRole === "operator" ? operatorId() : secondOperatorId(),
    );

    const discussionMarker = `US4-DISCUSSION-${randomUUID()}`;
    const discussion = await call(`/workspaces/${workspaceId()}/discussions`, {
      role: concurrentLoserRole!,
      body: commandBody({ body: discussionMarker }),
    });
    expectJsonObject(discussion, 201);

    const positiveControl = await controlRun(concurrentWinnerRole!, "follow-ups", concurrentEpoch, {
      body: `US4 new-operator control ${randomUUID()}`,
    });
    expectJsonObject(positiveControl, 202);

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
  });

  it("[UAT-09][FR-036] requires a non-blank reason for forced takeover and changes one epoch", async () => {
    const before = await getWorkspace();
    const epoch = before.currentOperator.operatorEpoch;
    const revision = before.revision;

    const missingReason = await takeover("owner", "forced", undefined, epoch, revision);
    expectProblem(missingReason, 400, "invalid_request");

    const blankReason = await takeover("owner", "forced", "   ", epoch, revision);
    expectProblem(blankReason, 400, "invalid_request");

    expect(concurrentLoserRole, "depends on the concurrent-takeover step").toBeTruthy();
    const nonOwner = await takeover(
      concurrentLoserRole!,
      "forced",
      "not an owner",
      epoch,
      revision,
    );
    expectProblem(nonOwner, 403, "permission_denied");

    const stale = await takeover(
      "owner",
      "forced",
      "stale reason",
      Math.max(0, epoch - 1),
      revision,
    );
    expectProblem(stale, 409, "operator_changed");
    expect((await getWorkspace()).currentOperator.operatorId).toBe(concurrentWinnerId);

    const reason = `US4 forced reason ${randomUUID()}`;
    const accepted = await takeover("owner", "forced", reason, epoch, revision);
    const control = expectJsonObject(accepted, 200);

    const after = await getWorkspace();
    expect(after.currentOperator.operatorId).toBe(ownerId());
    expect(after.currentOperator.operatorEpoch).toBe(epoch + 1);
    expect(control.operatorEpoch ?? after.currentOperator.operatorEpoch).toBe(epoch + 1);

    const afterRun = await getRun();
    expect(afterRun.id).toBe(baselineRun.id);
    expect(afterRun.state).toBe("running");
    expect(afterRun.operatorEpoch).toBe(epoch + 1);

    const event = await waitForEvent(
      "operator",
      baselineSequence,
      (candidate) =>
        candidate.type === "handoff.takeover" && JSON.stringify(candidate).includes(reason),
    );
    expect(JSON.stringify(event)).toContain(String(epoch + 1));

    const previousOperatorStop = await controlRun(concurrentWinnerRole!, "stop", concurrentEpoch, {
      confirmedStop: true,
      body: "US4 stale winner stop",
    });
    expectProblem(previousOperatorStop, 409, "operator_changed");

    const ownerControl = await controlRun("owner", "follow-ups", epoch + 1, {
      body: `US4 owner control ${randomUUID()}`,
    });
    expectJsonObject(ownerControl, 202);
  });
});
