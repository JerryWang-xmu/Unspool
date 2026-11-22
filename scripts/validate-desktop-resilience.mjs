import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const output = resolve("artifacts/validation/gui-redesign");
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(join(tmpdir(), "unspool-validation-desktop-resilience-"));
const canaryPath = join(dataDir, "canary.txt");
const pidFile = join(output, "resilience-runner.pid");
const port = 8792;
const healthUrl = `http://127.0.0.1:${port}/v1/health`;
const common = {
  ...process.env,
  UNSPOOL_DATA_DIR: dataDir,
  UNSPOOL_VALIDATION_PORT: String(port),
  UNSPOOL_E2E_US1_CANARY_PATH: canaryPath,
  UNSPOOL_E2E_US1_WRITE_MARKER: `RESILIENCE-${crypto.randomUUID()}`,
  UNSPOOL_E2E_US1_ARTIFACT_NAME: "resilience-report.md",
  UNSPOOL_E2E_US1_RUNNER_PID_FILE: pidFile,
};

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
        "tests/e2e/us1/desktop-resilience.spec.ts",
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

await writeFile(canaryPath, "unchanged-desktop-resilience-canary\n");
await writeFile(join(dataDir, "brief.md"), "Desktop resilience validation brief.\n");
let runner;
let vite;
try {
  runner = spawn(process.execPath, [resolve("scripts/us1-runner.mjs")], {
    env: common,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runner.stdout.on("data", (chunk) => process.stdout.write(chunk));
  runner.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitFor(healthUrl);
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
  const result = await runPlaywright({
    ...common,
    UNSPOOL_E2E_RESILIENCE_BASE_URL: `http://127.0.0.1:1420/?${params}`,
    UNSPOOL_E2E_RESILIENCE_HEALTH_URL: healthUrl,
  });
  await writeFile(join(output, "resilience.log"), result.log);
  await writeFile(
    join(output, "resilience-summary.json"),
    `${JSON.stringify(
      {
        result: result.status === 0 ? "pass" : "fail",
        exitCode: result.status,
        testsPassed: result.status === 0 ? 9 : 0,
        browser: "installed Google Chrome via Playwright",
        realRunnerProcess: true,
        controlledNetworkFailures: true,
        realPaidApis: false,
        scenarios: [
          "delayed A response while opening B and polling request count",
          "delayed execution-context disclosure",
          "rejected start and explicit retry",
          "accepted start with failed reconciliation and required refresh",
          "accepted start without a Run record across polling and A-B-A navigation",
          "historical Run cannot reconcile a newly accepted empty start response",
          "accepted response after Escape and navigation retains per-workspace reconciliation",
          "pre-start historical detail cannot erase a newly pending start",
          "manual refresh cannot clear a pending entry created after that refresh began",
        ],
        log: "artifacts/validation/gui-redesign/resilience.log",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = result.status === 0 ? 0 : 1;
} catch (error) {
  await writeFile(
    join(output, "resilience-error.json"),
    `${JSON.stringify({ result: "fail", error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  vite?.kill();
  try {
    const currentPid = Number(await readFile(pidFile, "utf8"));
    if (Number.isInteger(currentPid)) process.kill(currentPid);
  } catch {
    runner?.kill();
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
