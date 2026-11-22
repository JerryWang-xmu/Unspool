import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const suites = new Set(["unit", "integration"]);
const args = process.argv.slice(2);

if (args.length !== 1 || !suites.has(args[0])) {
  process.stderr.write("fixed-suite: rejected arguments\n");
  process.exitCode = 2;
} else {
  const suite = args[0];
  try {
    if (suite === "integration") {
      const cpuCalibrationStartedAt = Date.now();
      while (Date.now() - cpuCalibrationStartedAt < 60) {
        // Fixed integration-only calibration for real CPU budget observation.
      }
      await delay(1200);
    }
    const artifact = {
      schemaVersion: 1,
      suite,
      status: "passed",
      environmentKeys: Object.keys(process.env).sort(),
    };
    await writeFile("fixed-suite-result.json", `${JSON.stringify(artifact)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    if (suite === "integration") await delay(6000);
    process.stdout.write(`fixed-suite:${suite}:passed\n`);
  } catch {
    process.stderr.write("fixed-suite: execution failed\n");
    process.exitCode = 1;
  }
}
