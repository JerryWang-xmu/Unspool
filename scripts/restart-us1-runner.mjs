import { spawn } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const controlIndex = process.argv.indexOf("--control");
const controlPath = controlIndex < 0 ? undefined : process.argv[controlIndex + 1];
const control = controlPath === undefined ? {} : JSON.parse(await readFile(controlPath, "utf8"));
const configuration = { ...process.env, ...control };
const dataDir = configuration.UNSPOOL_DATA_DIR;
const pidFile = configuration.UNSPOOL_E2E_US1_RUNNER_PID_FILE;
if (!dataDir?.includes("validation") || !pidFile)
  throw new Error(
    `Refusing to restart anything except the dedicated US1 validation Runner (control=${controlPath ?? "missing"}, dataDirValid=${dataDir?.includes("validation") === true}, pidFilePresent=${typeof pidFile === "string"})`,
  );
const previousPid = Number(await readFile(pidFile, "utf8"));
if (Number.isInteger(previousPid) && previousPid > 0 && previousPid !== process.pid) {
  try {
    process.kill(previousPid);
  } catch {}
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(previousPid, 0);
    } catch {
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}
const logHandle = await open(resolve("artifacts/validation/us1/gui/runner.log"), "a");
const child = spawn(process.execPath, [resolve("scripts/us1-runner.mjs")], {
  cwd: process.cwd(),
  env: configuration,
  detached: true,
  stdio: ["ignore", logHandle.fd, logHandle.fd],
});
child.unref();
await writeFile(pidFile, String(child.pid));
await logHandle.close();
const healthUrl = configuration.UNSPOOL_E2E_US1_RUNNER_HEALTH_URL;
if (healthUrl) {
  let healthy = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      healthy = (await fetch(healthUrl, { signal: AbortSignal.timeout(500) })).ok;
    } catch {}
    if (healthy) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!healthy) throw new Error("Restarted US1 Runner did not become healthy");
}
console.log(`Restarted dedicated US1 validation Runner with pid ${child.pid}`);
