import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApprovalRequest } from "../apps/runner-api/dist/apps/runner-api/src/approvals/service.js";
import { createSqliteApprovalStore } from "../apps/runner-api/dist/apps/runner-api/src/approvals/store.js";
import { ContextService } from "../apps/runner-api/dist/apps/runner-api/src/context/service.js";
import { buildServer } from "../apps/runner-api/dist/apps/runner-api/src/index.js";
import { RunsService } from "../apps/runner-api/dist/apps/runner-api/src/runs/service.js";
import { WorkspacesService } from "../apps/runner-api/dist/apps/runner-api/src/workspaces/service.js";
import { openDatabase } from "../apps/runner-api/dist/packages/persistence/src/database.js";
import { uuidv7 } from "../apps/runner-api/dist/packages/security/src/uuid.js";

const ownerToken = "validation-us2-us4-owner";
const recipientToken = "validation-us4-recipient";
const recipientId = "us4-recipient";
const port = 8794;
const base = `http://127.0.0.1:${port}/v1`;
const output = resolve("artifacts/validation/us2/full-workflow");
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(join(tmpdir(), "unspool-validation-us2-workflow-"));
const canary = join(dataDir, "approval-canary.txt");
await writeFile(canary, "UAT28 approval canary must remain unchanged\n");
const initialHash = createHash("sha256")
  .update(await readFile(canary))
  .digest("hex");

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
async function api(role, path, { method, body, expected } = {}) {
  const token = role === "owner" ? ownerToken : recipientToken;
  const response = await fetch(`${base}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status !== expected)
    throw new Error(`${path}: expected ${expected}, got ${response.status}: ${text}`);
  return text.length === 0 ? null : JSON.parse(text);
}
async function appendEvent(database, workspaceId, runId, actorId, type, payload) {
  const id = uuidv7();
  const now = new Date().toISOString();
  await database.write(async (transaction) => {
    await transaction.execute(
      `INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, ?, ?, ?, ?, 'owner_private', ?, ?, ?)`,
      [
        id,
        workspaceId,
        workspaceId,
        type,
        actorId,
        runId,
        now,
        `event:${id}`,
        digestValue(payload),
        JSON.stringify(payload),
      ],
    );
  });
}
function digestValue(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Endpoint not ready: ${url}`);
}
async function runPlaywright(env) {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/e2e/us2/full-workflow.spec.ts",
        "--project=chromium",
        "--reporter=list",
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => resolveResult({ status: null, log, error }));
    child.on("close", (status) => resolveResult({ status, log }));
  });
}

const server = await buildServer({
  dataDir,
  ownerToken,
  additionalTokens: { [recipientToken]: { id: recipientId, displayName: "UAT28 Recipient" } },
});
const database = await openDatabase({ filename: join(dataDir, "unspool.sqlite") });
const runs = new RunsService({
  database,
  workspaces: new WorkspacesService({ database }),
  context: new ContextService({ database }),
});
let busy = false;
let seeded = false;
let controllerError = null;
async function poll() {
  if (busy) return;
  busy = true;
  try {
    if (!seeded) {
      const rows = await database.query(
        "SELECT id, owner_id AS ownerId FROM workspace WHERE kind = 'shared' AND name LIKE 'UAT28%' LIMIT 1",
      );
      const workspace = rows[0];
      if (workspace !== undefined) {
        const started = await runs.startRun(
          workspace.ownerId,
          workspace.id,
          { operatorEpoch: 1, body: "UAT28 fixture Run", payloadDigest: digestValue("start") },
          uuidv7(),
        );
        const run = started.response.run;
        const attemptId = uuidv7();
        const toolCallId = uuidv7();
        const approvalId = uuidv7();
        const now = new Date();
        await database.execute(
          "INSERT INTO run_attempt (id, run_id, worker_id, attempt_epoch, state, lease_expires_at, started_at) VALUES (?, ?, 'uat28-validation-worker', 1, 'running', ?, ?)",
          [attemptId, run.id, new Date(now.getTime() + 3_600_000).toISOString(), now.toISOString()],
        );
        const pending = createApprovalRequest({
          id: approvalId,
          actionProposalId: uuidv7(),
          requesterId: workspace.ownerId,
          action: {
            toolName: "write_file",
            canonicalArgs: { path: canary, content: "must not execute" },
            target: canary,
            workingDirectory: dataDir,
          },
          purpose: "UAT28 approval rejection fixture",
          impact: "Would replace the unchanged canary",
          risk: "high",
          displayArgs: { path: canary },
          secretRefs: [],
          policyRevision: 1,
          now,
          requiredApproverPolicy: {
            approverIds: [workspace.ownerId],
            allowRequesterSelfApproval: true,
          },
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
        await database.execute("UPDATE run SET state = 'waiting_approval' WHERE id = ?", [run.id]);
        await appendEvent(database, workspace.id, run.id, workspace.ownerId, "approval.requested", {
          approvalId,
          toolCallId,
          toolName: "write_file",
          approvalRequired: true,
        });
        const source = await api("owner", `/workspaces/${workspace.id}/sources`, {
          body: command({
            originType: "artifact",
            originId: "uat28-source",
            contentRef: "artifact://uat28-source",
            contentDigest: digestValue("UAT28 evidence"),
          }),
          expected: 201,
        });
        const conclusion = await api("owner", `/workspaces/${workspace.id}/conclusions`, {
          body: command({
            kind: "fact",
            body: "UAT28 conclusion requiring human confirmation",
            scope: "completion",
            sourceVersionIds: [source.sourceVersionId],
          }),
          expected: 201,
        });
        await appendEvent(database, workspace.id, run.id, workspace.ownerId, "evidence.proposed", {
          conclusionId: conclusion.id,
        });
        seeded = true;
      }
    }
    const stopping = await database.query(
      `SELECT r.id AS runId, r.workspace_id AS workspaceId, r.operator_epoch AS operatorEpoch, c.operator_id AS operatorId FROM run r JOIN workspace_control c ON c.workspace_id = r.workspace_id WHERE r.state = 'stopping'`,
    );
    for (const run of stopping)
      await runs.settleStoppedRun(run.operatorId, run.workspaceId, run.runId, run.operatorEpoch);
  } catch (error) {
    controllerError = error instanceof Error ? error.message : String(error);
    console.error(controllerError);
  } finally {
    busy = false;
  }
}

let vite;
let interval;
try {
  await server.listen({ host: "127.0.0.1", port });
  const owner = (await api("owner", "/me", { expected: 200 })).principal;
  const team = await api("owner", "/teams", {
    body: command({ name: "UAT28 workflow team" }),
    expected: 201,
  });
  const teamId = team.id ?? team.team?.id;
  await api("owner", `/teams/${teamId}/members`, {
    body: command({ userId: recipientId, teamRoles: ["member"] }),
    expected: 201,
  });
  vite = spawn(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "1420",
      "--strictPort",
    ],
    { cwd: resolve("apps/desktop"), stdio: ["ignore", "pipe", "pipe"] },
  );
  vite.stdout.on("data", (chunk) => process.stdout.write(chunk));
  vite.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitFor("http://127.0.0.1:1420");
  interval = setInterval(() => {
    void poll();
  }, 40);
  const params = new URLSearchParams({ runnerApi: base, runnerToken: ownerToken });
  const result = await runPlaywright({
    ...process.env,
    UNSPOOL_E2E_BASE_URL: `http://127.0.0.1:1420/?${params}`,
    UNSPOOL_E2E_US2_FIXTURE_URL: `${base}/health`,
    UNSPOOL_E2E_US2_RECIPIENT_TOKEN: recipientToken,
    UNSPOOL_E2E_US2_RECIPIENT_ID: recipientId,
  });
  clearInterval(interval);
  const finalHash = createHash("sha256")
    .update(await readFile(canary))
    .digest("hex");
  await writeFile(
    join(output, "runner.json"),
    `${JSON.stringify({ nodeVersion: process.version, exitCode: result.status, ownerId: owner.id, controllerError, initialHash, finalHash, unchanged: initialHash === finalHash, log: result.log }, null, 2)}\n`,
  );
  if (result.status === 0) {
    const summaryPath = join(output, "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.initialSha256 = initialHash;
    summary.finalSha256 = finalHash;
    summary.approvalRejectionChangedFile = initialHash !== finalHash;
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.exitCode =
    result.status === 0 && initialHash === finalHash && controllerError === null ? 0 : 1;
} catch (error) {
  console.error(error);
  await writeFile(
    join(output, "runner-error.json"),
    `${JSON.stringify({ result: "fail", error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  process.exitCode = 1;
} finally {
  if (interval) clearInterval(interval);
  vite?.kill();
  await server.close();
  await database.close();
  if (process.env.UNSPOOL_US2_WORKFLOW_KEEP_DATA !== "1")
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
