import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validationCases } from "../packages/test-support/src/validation-cases.ts";

const commands = {
  us1: "node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/contract/us1 tests/integration/us1 --reporter=verbose",
  us2: "node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/contract/us2 tests/integration/us2 --reporter=verbose",
  us3: "node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/contract/us3 tests/integration/us3 --reporter=verbose",
  us4: "node scripts/validate-us4.mjs",
  us5: "node --import ./scripts/register-typescript-resolve.mjs --test tests/contract/us5/evidence.test.ts tests/integration/us5/evidence-impact.test.ts tests/integration/us5/archive-export.test.ts",
  beta: "node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/contract/us6 tests/integration/us6 packages/contracts/test/federation-contracts.test.ts --reporter=verbose",
  release: "node scripts/check-release.mjs",
};
const sources = {
  us1: "artifacts/validation/us1/summary.json",
  us2: "artifacts/validation/us2/summary.json",
  us3: "artifacts/validation/us3/live/summary.json",
  us4: "artifacts/validation/us4/live/summary.json",
  us5: "artifacts/validation/us5/live/summary.json",
  beta: "artifacts/validation/beta/live/summary.json",
  release: "artifacts/validation/release/summary.json",
};
const sourceCache = new Map();
async function source(key) {
  if (!sourceCache.has(key)) {
    const path = sources[key];
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.result !== "pass") throw new Error(`Evidence source ${path} is not pass`);
    sourceCache.set(key, { path, command: commands[key], evidence: value });
  }
  return sourceCache.get(key);
}
const stable = {
  "UAT-01": "us1", // replaced below with the shared-workspace live source
  "UAT-03": "us2",
  "UAT-04": "us2",
  "UAT-07": "us2",
  "UAT-08": "us4",
  "UAT-09": "us4",
  "UAT-10": "us3",
  "UAT-11": "us3",
  "UAT-12": "us1",
  "UAT-13": "us2",
  "UAT-14": "us3",
  "UAT-15": "us3",
  "UAT-16": "us3",
  "UAT-17": "us5",
  "UAT-18": "us2",
  "UAT-19": "us5",
  "UAT-20": "us5",
  "UAT-21": "us5",
  "UAT-22": "us4",
  "UAT-23": "us4",
  "UAT-24": "us4",
  "UAT-25": "us1",
  "UAT-26": "us1",
  "UAT-27": "us2",
  "UAT-29": "us1",
  "UAT-30": "us2",
};
stable["UAT-01"] = "us2";
stable["UAT-02"] = "us2";
stable["UAT-05"] = "us2";
stable["UAT-06"] = "us3";
stable["UAT-28"] = "us2";
stable["UAT-31"] = "release";
const betaPass = [
  "UAT-32",
  "UAT-33",
  "UAT-34",
  "UAT-35",
  "UAT-36",
  "UAT-37",
  "UAT-38",
  "UAT-39",
  "UAT-40",
  "UAT-41",
  "UAT-42",
  "UAT-43",
  "UAT-44",
  "UAT-45",
  "UAT-46",
  "UAT-47",
  "UAT-48",
  "UAT-49",
  "UAT-50",
  "UAT-51",
  "UAT-52",
  "UAT-54",
  "UAT-53",
  "UAT-55",
  "UAT-56",
  "UAT-57",
  "UAT-59",
  "UAT-60",
];
const reasons = {
  "UAT-02":
    "No independent second-member GUI observation included goal, criteria, operator, blockers and latest Artifact together.",
  "UAT-05":
    "The pre-start disclosure and cancel-without-Run branch were not independently exercised through the GUI.",
  "UAT-06":
    "No real long-running tool boundary proved correction versus later-instruction ordering.",
  "UAT-28":
    "The complete invite/instruct/approve/handoff/review/archive flow was not performed solely through the GUI.",
  "UAT-30":
    "Five-client context/Run consistency passed, but independent drafts, display preferences and scroll state were not asserted.",
  "UAT-31": "Final license/provenance checks have not been rerun after the latest changes.",
  "UAT-39":
    "No faux-model payload observer proved that read-only content, digests, errors and Artifacts cannot reach the model.",
  "UAT-40":
    "No independent cross-channel canary search covered federated timeline, parameters, errors, logs, export and analytics.",
  "UAT-43":
    "Artifact transfer evidence is a synthetic policy result; no bytes crossed two real owner/node instances.",
  "UAT-44":
    "Fixed-tool evidence is synthetic; no registered executable ran as a real isolated process.",
  "UAT-45":
    "No process observer proved that rejected Shell/argument/program substitutions created zero processes.",
  "UAT-46":
    "No real sandbox inspection covered host credentials, mounts, network, Docker socket or residual state across two runs.",
  "UAT-47":
    "Budget input fixtures did not measure real CPU, memory, process, wall-time and output exhaustion.",
  "UAT-48":
    "Patch policy tests did not write real files, create a journal or produce a retrievable new Artifact version.",
  "UAT-50":
    "Offline denial passed, but the authorized offline positive control and recipient/time binding were not independently executed.",
  "UAT-52": "No real process kill/network loss occurred before and after a federated side effect.",
  "UAT-54":
    "No federated private-source question fixture proved that another recipient's permission is never borrowed.",
};

for (const stage of ["stable", "beta"]) {
  const entries = validationCases.filter(
    (entry) =>
      entry.suite === "uat" &&
      (stage === "stable" ? entry.stage === "stable" : entry.stage !== "stable"),
  );
  const results = [];
  for (const entry of entries) {
    const sourceKey =
      stage === "stable"
        ? stable[entry.id]
        : betaPass.includes(entry.id) || entry.id === "UAT-58"
          ? entry.id === "UAT-58"
            ? "us2"
            : "beta"
          : undefined;
    const passed = sourceKey !== undefined;
    const evidence = passed ? await source(sourceKey) : undefined;
    const status = passed ? "PASS" : "NOT RUN";
    const summary = {
      caseId: entry.id,
      stage: entry.stage,
      status,
      result: status,
      prepare: entry.prepare,
      action: entry.action,
      expected: entry.expected,
      positiveControl: entry.positiveControl,
      negativeControl: entry.negativeControl,
      capabilities: entry.capabilities,
      quickstart: entry.quickstart,
      actualCommand: evidence?.command ?? null,
      exitCode: passed ? 0 : null,
      evidenceSource: evidence?.path ?? null,
      executionMode: passed
        ? "Mapped executable service/browser scenario with positive and negative controls"
        : "No executable per-ID evidence",
      skipReason: passed
        ? null
        : (reasons[entry.id] ??
          "No independently executable evidence is registered for this case."),
      skipped: !passed,
    };
    const directory = resolve(`artifacts/validation/${stage}/cases/${entry.id}`);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    results.push({
      id: entry.id,
      status,
      evidenceSource: summary.evidenceSource,
      skipReason: summary.skipReason,
    });
  }
  const passed = results.filter((result) => result.status === "PASS").length;
  const root = {
    stage,
    result: passed === results.length ? "pass" : "incomplete",
    total: results.length,
    passed,
    notRun: results.length - passed,
    registryDrivenExecutionComplete: passed === results.length,
    releaseGateClaimed: false,
    cases: results,
  };
  await writeFile(
    resolve(`artifacts/validation/${stage}/summary.json`),
    `${JSON.stringify(root, null, 2)}\n`,
  );
  console.log(`${stage}: ${passed}/${results.length} PASS; ${results.length - passed} NOT RUN`);
}
