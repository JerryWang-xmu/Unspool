import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApprovalRequest } from "../apps/runner-api/dist/apps/runner-api/src/approvals/service.js";
import { createSqliteApprovalStore } from "../apps/runner-api/dist/apps/runner-api/src/approvals/store.js";
import { buildServer } from "../apps/runner-api/dist/apps/runner-api/src/index.js";
import { openDatabase } from "../apps/runner-api/dist/packages/persistence/src/database.js";
import { uuidv7 } from "../apps/runner-api/dist/packages/security/src/uuid.js";

const TOKENS = {
  owner: "validation-us2-us4-owner",
  operator: "validation-us4-operator",
  recipient: "validation-us4-recipient",
  second_operator: "validation-us4-second-operator",
  outsider: "validation-us4-outsider",
};
const IDS = {
  operator: "us4-operator",
  recipient: "us4-recipient",
  second_operator: "us4-second-operator",
  outsider: "us4-outsider",
};
const SUITES = [
  { id: "contract", file: "tests/contract/us4/handoffs.test.ts", port: 8791 },
  {
    id: "private-preparation",
    file: "tests/integration/us4/private-preparation.test.ts",
    port: 8792,
  },
  { id: "operator-epoch", file: "tests/integration/us4/operator-epoch.test.ts", port: 8793 },
];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}
function command(payload) {
  return {
    schemaVersion: 1,
    commandId: randomUUID(),
    payloadDigest: `sha256:${createHash("sha256").update(canonical(payload)).digest("hex")}`,
    ...payload,
  };
}
async function api(base, role, path, { method, body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${TOKENS[role]}`,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status !== expected)
    throw new Error(
      `${method ?? "POST"} ${path}: expected ${expected}, received ${response.status}: ${text}`,
    );
  return text.length === 0 ? null : JSON.parse(text);
}
function entity(body, key) {
  if (body?.[key] !== undefined) return body[key];
  return body;
}

async function createWorkspace(base, team, name, includeMainMembers) {
  const created = await api(base, "owner", "/workspaces", {
    body: command({
      name,
      goal: "US4 running handoff goal",
      completionCriteria: "Transfer responsibility without stopping the Run",
      teamId: team.teamId,
      runnerId: team.runnerId,
      agentProfileId: team.agentProfileId,
    }),
    expected: 201,
  });
  const workspace = entity(created, "workspace");
  const members = includeMainMembers
    ? [
        { userId: IDS.operator, role: "operator", canApprove: true, canReview: true },
        { userId: IDS.recipient, role: "contributor", canApprove: false, canReview: true },
        { userId: IDS.second_operator, role: "operator", canApprove: true, canReview: true },
        { userId: IDS.outsider, role: "observer", canApprove: false, canReview: false },
      ]
    : [{ userId: IDS.operator, role: "operator", canApprove: true, canReview: true }];
  await api(base, "owner", `/workspaces/${workspace.id}/members`, {
    body: command({ members }),
    expected: 201,
  });
  return workspace;
}

async function seed(base, dataDir) {
  const owner = (await api(base, "owner", "/me")).principal;
  const teamCreated = await api(base, "owner", "/teams", {
    body: command({ name: "US4 validation team" }),
    expected: 201,
  });
  const teamId = entity(teamCreated, "team").id;
  const runnerCreated = await api(base, "owner", `/teams/${teamId}/runners`, {
    body: command({
      name: "US4 faux runner",
      purpose: "US4 validation",
      version: "test",
      capabilities: [],
      allowedSubjects: [owner.id, ...Object.values(IDS)],
    }),
    expected: 201,
  });
  const runnerId = entity(runnerCreated, "runner").id;
  const profileCreated = await api(base, "owner", `/runners/${runnerId}/model-profiles`, {
    body: command({ provider: "faux", model: "faux-us4", reasoningOptions: {}, enabled: true }),
    expected: 201,
  });
  const profile = entity(profileCreated, "profile");
  const team = { teamId, runnerId, agentProfileId: profile.profileId ?? profile.id };
  for (const userId of Object.values(IDS)) {
    await api(base, "owner", `/teams/${teamId}/members`, {
      body: command({ userId, teamRoles: ["member"] }),
      expected: 201,
    });
  }
  const workspace = await createWorkspace(base, team, "US4 active handoff", true);
  const idle = await createWorkspace(base, team, "US4 idle takeover", false);
  const visible = await api(base, "operator", `/workspaces/${workspace.id}/context-items`, {
    body: command({
      kind: "fact",
      title: "US4 visible decision",
      body: "US4-VISIBLE-ANSWER: the approved decision is recorded",
      memberVisibility: "members",
      agentExposure: "provide_next_run",
      sourceRefs: [],
    }),
    expected: 201,
  });
  const visibleItem = entity(visible, "contextItem");
  const privateSource = await api(base, "operator", `/workspaces/${workspace.id}/context-items`, {
    body: command({
      kind: "fact",
      title: "US4 operator private",
      body: "US4-PRIVATE-SOURCE-MARKER",
      memberVisibility: "private",
      agentExposure: "not_provided",
      sourceRefs: [],
    }),
    expected: 201,
  });
  const privateItem = entity(privateSource, "contextItem");
  const started = await api(base, "operator", `/workspaces/${workspace.id}/runs`, {
    body: command({ operatorEpoch: 1, body: "US4 long running faux task" }),
    expected: 202,
  });
  const run = entity(started, "run");
  const canary = join(dataDir, "canary.txt");
  await writeFile(canary, "unchanged-us4-canary\n");
  const analytics = join(dataDir, "analytics-export.json");
  await writeFile(analytics, "{}\n");
  const approvalId = uuidv7();
  const database = await openDatabase({ filename: join(dataDir, "unspool.sqlite") });
  try {
    const attemptId = uuidv7();
    const toolCallId = uuidv7();
    const now = new Date();
    await database.execute(
      "INSERT INTO run_attempt (id, run_id, worker_id, attempt_epoch, state, lease_expires_at, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
      [
        attemptId,
        run.id,
        "us4-validation-worker",
        1,
        new Date(now.getTime() + 3_600_000).toISOString(),
        now.toISOString(),
      ],
    );
    const pending = createApprovalRequest({
      id: approvalId,
      actionProposalId: uuidv7(),
      requesterId: owner.id,
      action: {
        toolName: "write_file",
        canonicalArgs: { path: canary, content: "must not execute" },
        target: canary,
      },
      purpose: "US4 pending approval; preparation must not execute it",
      impact: "Would replace the US4 canary",
      risk: "high",
      displayArgs: { path: canary },
      secretRefs: [],
      policyRevision: 1,
      now,
      requiredApproverPolicy: { approverIds: [IDS.operator], allowRequesterSelfApproval: false },
      runId: run.id,
      attemptId,
      toolCallId,
    });
    await database.execute(
      "INSERT INTO tool_call_record (id, run_attempt_id, tool_call_id, tool_name, original_args_digest, effective_args_digest, state, preflight_at) VALUES (?, ?, ?, 'write_file', ?, ?, 'waiting_approval', ?)",
      [
        toolCallId,
        attemptId,
        toolCallId,
        pending.proposal.actionDigest,
        pending.proposal.actionDigest,
        now.toISOString(),
      ],
    );
    await createSqliteApprovalStore(database).save(pending);
  } finally {
    await database.close();
  }
  return {
    US4_WORKSPACE_ID: workspace.id,
    US4_RUN_ID: run.id,
    US4_IDLE_WORKSPACE_ID: idle.id,
    US4_OPERATOR_ID: IDS.operator,
    US4_RECIPIENT_ID: IDS.recipient,
    US4_SECOND_OPERATOR_ID: IDS.second_operator,
    US4_OWNER_ID: owner.id,
    US4_OUTSIDER_ID: IDS.outsider,
    US4_MAIN_CONVERSATION_ID: run.conversationId,
    US4_VISIBLE_SOURCE_ID: visibleItem.currentVersionId,
    US4_VISIBLE_SOURCE_TITLE: "US4 visible decision",
    US4_VISIBLE_SOURCE_ANSWER: "US4-VISIBLE-ANSWER",
    US4_PRIVATE_SOURCE_ID: privateItem.currentVersionId,
    US4_SECRET_MARKER: "US4-PRIVATE-SOURCE-MARKER",
    US4_PENDING_APPROVAL_ID: approvalId,
    US4_CANARY_FILE: canary,
    US4_ANALYTICS_EXPORT_PATH: analytics,
    US4_LONG_TASK_PROMPT: "US4 long running faux task",
  };
}

const outputRoot = resolve("artifacts/validation/us4/live");
await mkdir(outputRoot, { recursive: true });
const results = [];
for (const suite of SUITES.filter(
  (entry) =>
    process.env.UNSPOOL_US4_SUITE === undefined || entry.id === process.env.UNSPOOL_US4_SUITE,
)) {
  const dataDir = await mkdtemp(join(tmpdir(), `unspool-validation-us4-${suite.id}-`));
  let clock = Date.now();
  const server = await buildServer({
    dataDir,
    ownerToken: TOKENS.owner,
    now: () => new Date(clock),
    onAdvanceTime: (milliseconds) => {
      clock += milliseconds;
    },
    additionalTokens: {
      [TOKENS.operator]: { id: IDS.operator, displayName: "US4 Operator" },
      [TOKENS.recipient]: { id: IDS.recipient, displayName: "US4 Recipient" },
      [TOKENS.second_operator]: { id: IDS.second_operator, displayName: "US4 Second Operator" },
      [TOKENS.outsider]: { id: IDS.outsider, displayName: "US4 Outsider" },
    },
  });
  const base = `http://127.0.0.1:${suite.port}/v1`;
  try {
    await server.listen({ host: "127.0.0.1", port: suite.port });
    const fixture = await seed(base, dataDir);
    if (process.env.UNSPOOL_US4_DEBUG === "1") {
      console.time("debug-handoff-invite");
      const debugInvite = await api(
        base,
        "operator",
        `/workspaces/${fixture.US4_WORKSPACE_ID}/handoffs`,
        {
          body: command({ recipientId: IDS.recipient, reason: "debug invitation" }),
          expected: 201,
        },
      );
      console.timeEnd("debug-handoff-invite");
      console.log(JSON.stringify(debugInvite));
    }
    const env = {
      ...process.env,
      UNSPOOL_BASE_URL: base,
      US4_OPERATOR_TOKEN: TOKENS.operator,
      US4_RECIPIENT_TOKEN: TOKENS.recipient,
      US4_SECOND_OPERATOR_TOKEN: TOKENS.second_operator,
      US4_OWNER_TOKEN: TOKENS.owner,
      US4_OUTSIDER_TOKEN: TOKENS.outsider,
      US4_TEST_CLOCK_URL: `${base}/validation/clock`,
      ...fixture,
    };
    const executed = await new Promise((resolveResult) => {
      const child = spawn(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--config",
          "vitest.config.ts",
          suite.file,
          "--reporter=verbose",
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) =>
        resolveResult({ status: null, signal: null, error, stdout, stderr }),
      );
      child.on("close", (status, signal) =>
        resolveResult({ status, signal, error: undefined, stdout, stderr }),
      );
    });
    const log = `${executed.stdout}${executed.stderr}`;
    const logPath = join(outputRoot, `${suite.id}.log`);
    await writeFile(logPath, log);
    const result = {
      id: suite.id,
      command: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts ${suite.file} --reporter=verbose`,
      exitCode: executed.status,
      signal: executed.signal,
      error: executed.error?.message,
      logPath,
    };
    results.push(result);
    console.log(`${suite.id}: exit ${executed.status}; log ${logPath}`);
    if (executed.status !== 0) console.log(log);
  } catch (error) {
    results.push({
      id: suite.id,
      exitCode: null,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`${suite.id}: ${error instanceof Error ? error.stack : error}`);
  } finally {
    await server.close();
    if (process.env.UNSPOOL_US4_KEEP_DATA !== "1")
      await rm(dataDir, { recursive: true, force: true });
  }
}
const passed = results.every((result) => result.exitCode === 0);
await writeFile(
  join(outputRoot, "summary.json"),
  `${JSON.stringify({ stage: "US4 live HTTP isolated suites", nodeVersion: process.version, result: passed ? "pass" : "fail", results }, null, 2)}\n`,
);
process.exitCode = passed ? 0 : 1;
