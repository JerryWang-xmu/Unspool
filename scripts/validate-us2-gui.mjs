import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildServer } from "../apps/runner-api/dist/apps/runner-api/src/index.js";

const ownerToken = "validation-us2-us4-owner";
const operatorToken = "validation-us2-operator";
const contributorToken = "validation-us2-contributor";
const operatorId = "us2-operator";
const contributorId = "us2-contributor";
const port = 8790;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
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
async function api(token, path, body, expected = 200) {
  const response = await fetch(`http://127.0.0.1:${port}/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
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
  return JSON.parse(text);
}
async function waitForGui() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:1420");
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Desktop Vite server did not become ready");
}
async function runPlaywright(env) {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/e2e/us2/shared-workspace.spec.ts",
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

const dataDir = await mkdtemp(join(tmpdir(), "unspool-validation-us2-gui-"));
const output = resolve("artifacts/validation/us2/gui");
await mkdir(output, { recursive: true });
const server = await buildServer({
  dataDir,
  ownerToken,
  additionalTokens: {
    [operatorToken]: { id: operatorId, displayName: "US2 Operator" },
    [contributorToken]: { id: contributorId, displayName: "US2 Contributor" },
  },
});
let vite;
try {
  await server.listen({ host: "127.0.0.1", port });
  const owner = (await api(ownerToken, "/me")).principal;
  const team = await api(ownerToken, "/teams", command({ name: "US2 GUI validation team" }), 201);
  const teamId = team.id ?? team.team?.id;
  const runner = await api(
    ownerToken,
    `/teams/${teamId}/runners`,
    command({
      name: "US2 GUI faux runner",
      purpose: "GUI validation",
      version: "test",
      capabilities: [],
      allowedSubjects: [owner.id, operatorId, contributorId],
    }),
    201,
  );
  const runnerId = runner.id ?? runner.runner?.id;
  const profile = await api(
    ownerToken,
    `/runners/${runnerId}/model-profiles`,
    command({ provider: "faux", model: "faux-gui", reasoningOptions: {}, enabled: true }),
    201,
  );
  const agentProfileId = profile.profileId ?? profile.id ?? profile.profile?.id;
  for (const userId of [operatorId, contributorId])
    await api(
      ownerToken,
      `/teams/${teamId}/members`,
      command({ userId, teamRoles: ["member"] }),
      201,
    );
  const created = await api(
    ownerToken,
    "/workspaces",
    command({
      name: "US2 five-client shared workspace",
      goal: "Prove real GUI context convergence",
      completionCriteria: "Five clients display one context and Run",
      teamId,
      runnerId,
      agentProfileId,
    }),
    201,
  );
  const workspace = created.workspace ?? created;
  await api(
    ownerToken,
    `/workspaces/${workspace.id}/members`,
    command({
      members: [
        { userId: operatorId, role: "operator", canApprove: true, canReview: true },
        { userId: contributorId, role: "contributor", canApprove: false, canReview: true },
      ],
    }),
    201,
  );
  const run = await api(
    operatorToken,
    `/workspaces/${workspace.id}/runs`,
    command({ operatorEpoch: 1, body: "Keep the shared Run active for GUI convergence" }),
    202,
  );
  const artifactBytes = new TextEncoder().encode(
    "# Shared onboarding Artifact\n\nVisible to authorized workspace members.\n",
  );
  const metadata = {
    name: "shared-onboarding.md",
    mediaType: "text/markdown",
    size: artifactBytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`,
    kind: "reference",
    sourceSummary: "US2 GUI onboarding Artifact",
    runId: (run.run ?? run).id,
  };
  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("content", new Blob([artifactBytes], { type: "text/markdown" }), metadata.name);
  const uploaded = await fetch(`http://127.0.0.1:${port}/v1/workspaces/${workspace.id}/artifacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${operatorToken}`, "idempotency-key": randomUUID() },
    body: form,
  });
  if (uploaded.status !== 201)
    throw new Error(`Artifact fixture upload failed: ${uploaded.status} ${await uploaded.text()}`);

  const disclosureCreated = await api(
    ownerToken,
    "/workspaces",
    command({
      name: "US2 pre-start disclosure",
      goal: "Review exact context scope before execution",
      completionCriteria: "Cancel creates no Run; confirmation creates one scoped Run",
      teamId,
      runnerId,
      agentProfileId,
    }),
    201,
  );
  const disclosureWorkspace = disclosureCreated.workspace ?? disclosureCreated;
  await api(
    ownerToken,
    `/workspaces/${disclosureWorkspace.id}/members`,
    command({
      members: [{ userId: operatorId, role: "operator", canApprove: true, canReview: true }],
    }),
    201,
  );
  await api(
    operatorToken,
    `/workspaces/${disclosureWorkspace.id}/context-items`,
    command({
      kind: "fact",
      title: "Provided decision",
      body: "This version may be supplied",
      memberVisibility: "members",
      agentExposure: "provide_next_run",
      sourceRefs: [],
    }),
    201,
  );
  await api(
    operatorToken,
    `/workspaces/${disclosureWorkspace.id}/context-items`,
    command({
      kind: "fact",
      title: "Excluded private draft",
      body: "This version must not be supplied",
      memberVisibility: "private",
      agentExposure: "not_provided",
      sourceRefs: [],
    }),
    201,
  );

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
  await waitForGui();
  const params = new URLSearchParams({
    workspaceId: workspace.id,
    runnerApi: `http://127.0.0.1:${port}/v1`,
    runnerToken: operatorToken,
  });
  const secondParams = new URLSearchParams({
    workspaceId: workspace.id,
    runnerApi: `http://127.0.0.1:${port}/v1`,
    runnerToken: contributorToken,
  });
  const startParams = new URLSearchParams({
    workspaceId: disclosureWorkspace.id,
    runnerApi: `http://127.0.0.1:${port}/v1`,
    runnerToken: operatorToken,
  });
  const result = await runPlaywright({
    ...process.env,
    UNSPOOL_E2E_BASE_URL: `http://127.0.0.1:1420/?${params}`,
    UNSPOOL_E2E_US2_SECOND_MEMBER_URL: `http://127.0.0.1:1420/?${secondParams}`,
    UNSPOOL_E2E_US2_START_URL: `http://127.0.0.1:1420/?${startParams}`,
    UNSPOOL_E2E_US2_FIXTURE_URL: `http://127.0.0.1:${port}/v1/health`,
  });
  await writeFile(
    join(output, "runner.json"),
    `${JSON.stringify({ stage: "US2 GUI live Runner", nodeVersion: process.version, exitCode: result.status, workspaceId: workspace.id, runId: (run.run ?? run).id, log: result.log }, null, 2)}\n`,
  );
  process.exitCode = result.status === 0 ? 0 : 1;
} catch (error) {
  await writeFile(
    join(output, "runner-error.json"),
    `${JSON.stringify({ result: "fail", error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  vite?.kill();
  await server.close();
  if (process.env.UNSPOOL_US2_GUI_KEEP_DATA !== "1")
    await rm(dataDir, { recursive: true, force: true });
}
