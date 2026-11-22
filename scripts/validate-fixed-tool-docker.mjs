import { createHash } from "node:crypto";

const base = "http://127.0.0.1:8080";
const health = await (await fetch(`${base}/healthz`)).json();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
    return result;
  }
  return value;
}
function withDigest(template) {
  const body = {};
  for (const [key, value] of Object.entries(template)) if (key !== "digest") body[key] = value;
  return {
    ...template,
    digest: `sha256:${createHash("sha256")
      .update(JSON.stringify(canonical(body)))
      .digest("hex")}`,
  };
}
const budget = {
  maxFiles: 2,
  maxBytes: 4096,
  maxReadBytes: 4096,
  maxOutputBytes: 1024,
  maxDurationSeconds: 10,
  maxConcurrent: 1,
  cpuMillicpu: 500,
  memoryMb: 128,
  processes: 4,
};
function template(id, overrides = {}) {
  return withDigest({
    id,
    nodeId: "validation-node",
    version: 1,
    displayName: "Isolated fixed suite",
    purpose: "Run one registered shell-free suite",
    executableDigest: health.fixedSuiteDigest,
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["suite"],
      properties: {
        suite: {
          type: "string",
          enum: ["unit", "integration"],
          description: "Declared suite only",
        },
      },
    },
    workingScope: "fixture-base-snapshot",
    envAllowlist: [],
    networkPolicy: "disabled",
    outputLimit: 1024,
    sideEffectClass: "local_output_only",
    budget,
    ...overrides,
  });
}
async function post(path, body, expected) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (expected !== undefined && response.status !== expected)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  return { status: response.status, value };
}
const registered = template("fixed-suite-validation");
const created = await post("/templates", registered, 201);
if (created.value.value.digest !== registered.digest)
  throw new Error("Registered template digest changed unexpectedly");
const execution = await post(
  "/execute",
  { templateId: registered.id, templateDigest: registered.digest, arguments: { suite: "unit" } },
  200,
);
const result = execution.value.value;
if (result.state !== "succeeded") throw new Error(`Fixed suite failed: ${JSON.stringify(result)}`);
if (result.environmentKeys.length !== 0 || result.artifact.value.environmentKeys.length !== 0)
  throw new Error("Linux environment was not empty");
if (result.hostEnvironmentInherited !== false) throw new Error("Host environment was inherited");
if (result.networkAccesses !== 0 || result.shellInvocations !== 0)
  throw new Error("Unexpected network or shell activity");
if (result.workingDirectoryRemoved !== true) throw new Error("Working directory was not removed");
const inspected = await post("/inspect", { templateId: registered.id }, 200);
if (inspected.value.value.sandbox.dockerSocketPath !== null)
  throw new Error("Docker socket is exposed");
if (inspected.value.value.sandbox.inheritedMounts.length !== 0)
  throw new Error("Unexpected inherited mount");
const concurrentResults = await Promise.all([
  post("/execute", {
    templateId: registered.id,
    templateDigest: registered.digest,
    arguments: { suite: "integration" },
  }),
  post("/execute", {
    templateId: registered.id,
    templateDigest: registered.digest,
    arguments: { suite: "integration" },
  }),
]);
const outcome = (entry) => entry.value.value ?? entry.value;
const concurrentSuccesses = concurrentResults.filter(
  (entry) => outcome(entry).state === "succeeded",
);
const concurrentFailures = concurrentResults.filter(
  (entry) => outcome(entry).state === "failed" || entry.value.ok === false,
);
if (
  concurrentSuccesses.length > 1 ||
  concurrentFailures.length < 1 ||
  !["budget_exhausted", "concurrency_limit_exceeded"].includes(
    outcome(concurrentFailures[0]).error?.code,
  )
)
  throw new Error("Concurrent execution budget was not enforced");
const exhausted = {};
for (const [name, patch] of Object.entries({
  maxFiles: 1,
  maxBytes: 1,
  maxReadBytes: 1,
  memoryMb: 1,
  cpuMillicpu: 1,
})) {
  const current = template(`fixed-suite-budget-${name}`, { budget: { ...budget, [name]: patch } });
  await post("/templates", current, 201);
  const suite = ["memoryMb", "cpuMillicpu"].includes(name) ? "integration" : "unit";
  const run = await post(
    "/execute",
    { templateId: current.id, templateDigest: current.digest, arguments: { suite } },
    200,
  );
  if (run.value.value.state !== "failed" || run.value.value.error?.code !== "budget_exhausted")
    throw new Error(`Budget ${name} was not exhausted: ${JSON.stringify(run.value.value)}`);
  exhausted[name] = run.value.value.error.code;
}
const timeoutTemplate = template("fixed-suite-timeout", {
  budget: { ...budget, maxDurationSeconds: 1 },
});
await post("/templates", timeoutTemplate, 201);
const timeout = await post(
  "/execute",
  {
    templateId: timeoutTemplate.id,
    templateDigest: timeoutTemplate.digest,
    arguments: { suite: "integration" },
  },
  200,
);
if (
  timeout.value.value.state !== "failed" ||
  timeout.value.value.error?.code !== "wall_timeout" ||
  timeout.value.value.processGroupTerminated !== true
)
  throw new Error(`Timeout was not killed: ${JSON.stringify(timeout.value.value)}`);
const outputTemplate = template("fixed-suite-output", {
  outputLimit: 8,
  budget: { ...budget, maxOutputBytes: 8 },
});
await post("/templates", outputTemplate, 201);
const limited = await post(
  "/execute",
  {
    templateId: outputTemplate.id,
    templateDigest: outputTemplate.digest,
    arguments: { suite: "unit" },
  },
  200,
);
if (
  limited.value.value.state !== "failed" ||
  limited.value.value.error?.code !== "output_limit_exceeded"
)
  throw new Error("Output budget was not enforced");
const denied = await fetch("http://model-gateway:8080/healthz")
  .then(() => false)
  .catch(() => true);
if (!denied) throw new Error("model-gateway was reachable from the execution worker");
const allowedResponse = await fetch("http://fake-external:8080/healthz");
if (!allowedResponse.ok) throw new Error("Dedicated fake-external positive control failed");
console.log(
  JSON.stringify(
    {
      scenario: "B1 real fixed-tool Docker execution",
      result: "pass",
      nodeVersion: process.version,
      suiteState: result.state,
      linuxEnvironmentKeys: result.artifact.value.environmentKeys,
      hostEnvironmentInherited: result.hostEnvironmentInherited,
      shellInvocations: result.shellInvocations,
      networkAccesses: result.networkAccesses,
      workingDirectoryRemoved: result.workingDirectoryRemoved,
      dockerSocketPath: inspected.value.value.sandbox.dockerSocketPath,
      inheritedMounts: inspected.value.value.sandbox.inheritedMounts,
      concurrentSuccesses: concurrentSuccesses.length,
      concurrentFailureCode: outcome(concurrentFailures[0]).error.code,
      exhaustedBudgets: exhausted,
      timeoutCode: timeout.value.value.error.code,
      processGroupTerminated: timeout.value.value.processGroupTerminated,
      outputLimitCode: limited.value.value.error.code,
      modelGatewayDenied: denied,
      fakeExternalStatus: allowedResponse.status,
    },
    null,
    2,
  ),
);
