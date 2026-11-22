import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const ownerEnv = { ...process.env, UNSPOOL_OWNER_TOKEN: "validation-only", DOCKER_BUILDKIT: "0" };
const composeFile = ["compose", "-f", "deploy/docker/compose.yml", "--profile", "validation"];
function run(args, timeout = 30_000) {
  return new Promise((resolveResult) => {
    const child = spawn("docker", [...composeFile, ...args], {
      env: ownerEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ status: null, stdout, stderr, error });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr });
    });
  });
}
function executeScript(script) {
  return run(
    ["exec", "-T", "execution-worker-1", "node", "--input-type=module", "-e", script],
    30_000,
  );
}
async function artifactCount() {
  const result = await run([
    "exec",
    "-T",
    "execution-worker-1",
    "sh",
    "-c",
    "find /tmp -name fixed-suite-result.json | wc -l",
  ]);
  return Number(result.stdout.trim() || "0");
}
async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await executeScript(
      "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
    );
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Worker did not recover health");
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
    return result;
  }
  return value;
}
await waitForHealth();
await run([
  "exec",
  "-T",
  "execution-worker-1",
  "sh",
  "-c",
  "find /tmp -name fixed-suite-result.json -delete",
]);
const health = await executeScript(
  "fetch('http://127.0.0.1:8080/healthz').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))",
);
const fixedSuiteDigest = JSON.parse(health.stdout).fixedSuiteDigest;
const body = {
  id: "fixed-suite-kill-validation",
  nodeId: "validation-node",
  version: 1,
  displayName: "Kill recovery fixture",
  purpose: "Observe unknown outcome without automatic replay",
  executableDigest: fixedSuiteDigest,
  parameterSchema: {
    type: "object",
    additionalProperties: false,
    required: ["suite"],
    properties: { suite: { type: "string", enum: ["integration"] } },
  },
  workingScope: "fixture-base-snapshot",
  envAllowlist: [],
  networkPolicy: "disabled",
  outputLimit: 1024,
  sideEffectClass: "local_output_only",
  budget: {
    maxFiles: 2,
    maxBytes: 4096,
    maxReadBytes: 4096,
    maxOutputBytes: 1024,
    maxDurationSeconds: 30,
    maxConcurrent: 1,
    cpuMillicpu: 500,
    memoryMb: 128,
    processes: 4,
  },
};
const digest = `sha256:${createHash("sha256")
  .update(JSON.stringify(canonical(body)))
  .digest("hex")}`;
const template = { ...body, digest };
const templateJson = JSON.stringify(template).replaceAll("'", "\\'");
await executeScript(
  `fetch('http://127.0.0.1:8080/templates',{method:'POST',headers:{'content-type':'application/json'},body:'${templateJson}'}).then(async r=>{if(r.status!==201)throw new Error(await r.text())})`,
);

async function phase(name, expectedCount, waitForArtifact) {
  await executeScript(
    `fetch('http://127.0.0.1:8080/templates',{method:'POST',headers:{'content-type':'application/json'},body:'${templateJson}'}).then(async r=>{if(r.status!==201)throw new Error(await r.text())})`,
  );
  console.log(`phase ${name}: starting with ${await artifactCount()} existing artifacts`);
  const execution = executeScript(
    `fetch('http://127.0.0.1:8080/execute',{method:'POST',headers:{'content-type':'application/json'},body:'{"templateId":"fixed-suite-kill-validation","templateDigest":"${digest}","arguments":{"suite":"integration"}}'}).then(async r=>{const body=await r.text();if(!r.ok)throw new Error(body);console.log(body)})`,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, waitForArtifact ? 3_000 : 150));
  if (process.env.UNSPOOL_RECOVERY_NO_KILL === "1") {
    const result = await execution;
    console.log(`${name}: no-kill debug result ${JSON.stringify(result)}`);
    return { phase: name, debug: true };
  }
  const beforeKillCount = await artifactCount();
  const killed = await run(["kill", "-s", "SIGKILL", "execution-worker-1"]);
  if (killed.status !== 0) throw new Error(`Could not kill worker: ${killed.stderr}`);
  console.log(`phase ${name}: kill issued; ${beforeKillCount} artifacts observed`);
  const client = await execution;
  if (client.status !== 0)
    console.log(`${name}: client stdout=${client.stdout.trim()} stderr=${client.stderr.trim()}`);
  if (waitForArtifact && beforeKillCount !== 1)
    throw new Error(`${name}: expected one artifact before kill, got ${beforeKillCount}`);
  if (client.status === 0) throw new Error(`${name}: execution unexpectedly returned success`);
  const started = await run(["start", "execution-worker-1"]);
  if (started.status !== 0) throw new Error(`Worker did not restart: ${started.stderr}`);
  await waitForHealth();
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const finalCount = await artifactCount();
  if (finalCount > 1) throw new Error(`${name}: automatic replay produced ${finalCount} artifacts`);
  if (!waitForArtifact && finalCount !== expectedCount)
    throw new Error(`${name}: expected no artifact, got ${finalCount}`);
  return {
    phase: name,
    clientOutcome: "outcome_unknown",
    artifactsBeforeKill: beforeKillCount,
    artifactsAfterRestart: finalCount,
    automaticReplay: false,
  };
}

const before = await phase("kill_before_side_effect", 0, false);
const after = await phase("kill_after_artifact_before_response", 1, true);
console.log(
  JSON.stringify(
    {
      scenario: "B1 process kill and no automatic replay",
      result: "pass",
      phases: [before, after],
    },
    null,
    2,
  ),
);
