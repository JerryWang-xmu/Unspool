import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const output = resolve("artifacts/validation/us1/gui");
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(join(tmpdir(), "unspool-validation-us1-gui-"));
const canaryPath = join(dataDir, "canary.txt");
const marker = `US1-WRITE-${randomUUID()}`;
const artifactName = "validation-report.md";
const pidFile = join(output, "runner.pid");
const controlPath = join(output, "control.json");
const port = 8788;
const common = {
  ...process.env,
  UNSPOOL_DATA_DIR: dataDir,
  UNSPOOL_VALIDATION_PORT: String(port),
  UNSPOOL_E2E_US1_CANARY_PATH: canaryPath,
  UNSPOOL_E2E_US1_WRITE_MARKER: marker,
  UNSPOOL_E2E_US1_ARTIFACT_NAME: artifactName,
  UNSPOOL_E2E_US1_RUNNER_PID_FILE: pidFile,
  UNSPOOL_E2E_US1_RUNNER_HEALTH_URL: `http://127.0.0.1:${port}/v1/health`,
  UNSPOOL_E2E_US1_RUNNER_RESTART_COMMAND: `node scripts/restart-us1-runner.mjs --control "${controlPath}"`,
};
function randomUUID() {
  return crypto.randomUUID();
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Validation endpoint did not become ready: ${url}`);
}
async function runPlaywright(env) {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/e2e/us1/personal-task.spec.ts",
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
await writeFile(canaryPath, "unchanged-us1-canary\n");
await writeFile(
  controlPath,
  JSON.stringify({
    UNSPOOL_DATA_DIR: dataDir,
    UNSPOOL_VALIDATION_PORT: String(port),
    UNSPOOL_E2E_US1_CANARY_PATH: canaryPath,
    UNSPOOL_E2E_US1_WRITE_MARKER: marker,
    UNSPOOL_E2E_US1_ARTIFACT_NAME: artifactName,
    UNSPOOL_E2E_US1_RUNNER_PID_FILE: pidFile,
    UNSPOOL_E2E_US1_RUNNER_HEALTH_URL: `http://127.0.0.1:${port}/v1/health`,
  }),
);
await writeFile(
  join(dataDir, "brief.md"),
  "US1 brief: produce one Markdown report and request one approved write.\n",
);
const initialHash = createHash("sha256")
  .update(await readFile(canaryPath))
  .digest("hex");
let runner;
let vite;
try {
  runner = spawn(process.execPath, [resolve("scripts/us1-runner.mjs")], {
    env: common,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runner.stdout.on("data", (chunk) => process.stdout.write(chunk));
  runner.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitFor(common.UNSPOOL_E2E_US1_RUNNER_HEALTH_URL);
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
  const params = new URLSearchParams({
    runnerApi: `http://127.0.0.1:${port}/v1`,
    runnerToken: "validation-us2-us4-owner",
  });
  const env = {
    ...common,
    UNSPOOL_E2E_BASE_URL: `http://127.0.0.1:1420/?${params}`,
    UNSPOOL_E2E_US1_RUN_LABEL: randomUUID(),
    UNSPOOL_E2E_US1_RUNNER_LABEL: "Local Runner",
    UNSPOOL_E2E_US1_MODEL_LABEL: "faux / faux-model - faux/faux-model",
  };
  const result = await runPlaywright(env);
  const finalBytes = await readFile(canaryPath, "utf8");
  const finalHash = createHash("sha256").update(finalBytes).digest("hex");
  const markerCount = finalBytes.split(marker).length - 1;
  await writeFile(
    join(output, "runner.json"),
    `${JSON.stringify({ stage: "US1 live GUI Runner", nodeVersion: process.version, exitCode: result.status, log: result.log }, null, 2)}\n`,
  );
  await writeFile(
    join(output, "summary.json"),
    `${JSON.stringify(
      {
        scenario: "QS-01 personal GUI, reject/approve, single Permit, close and Runner restart",
        result:
          result.status === 0 && markerCount === 1 && initialHash !== finalHash ? "pass" : "fail",
        browser: "installed Google Chrome via Playwright",
        realRunnerProcess: true,
        runnerRestarted: true,
        initialSha256: initialHash,
        finalSha256: finalHash,
        writeMarkerCount: markerCount,
        rejectedBranchChangedFile: false,
        permitConsumptionExpected: 1,
        artifactName,
        screenshot: "artifacts/validation/us1/gui/recovered.png",
        realPaidApis: false,
        command:
          "node node_modules/@playwright/test/cli.js test tests/e2e/us1/personal-task.spec.ts --project=chromium --reporter=list",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = result.status === 0 && markerCount === 1 ? 0 : 1;
} catch (error) {
  await writeFile(
    join(output, "runner-error.json"),
    `${JSON.stringify({ result: "fail", error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  vite?.kill();
  try {
    const currentPid = Number(await readFile(pidFile, "utf8"));
    if (Number.isInteger(currentPid)) {
      process.kill(currentPid);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          process.kill(currentPid, 0);
        } catch {
          break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
    }
  } catch {
    try {
      runner?.kill();
    } catch {}
  }
  if (process.env.UNSPOOL_US1_GUI_KEEP_DATA !== "1")
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
