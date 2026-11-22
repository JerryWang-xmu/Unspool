import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FixedToolDigest = `sha256:${string}`;

export const FIXED_TOOL_SUITES = ["unit", "integration"] as const;
export type FixedToolSuite = (typeof FIXED_TOOL_SUITES)[number];

export interface FixedToolResourceBudget {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxReadBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDurationSeconds: number;
  readonly maxConcurrent: number;
  readonly cpuMillicpu: number;
  readonly memoryMb: number;
  readonly processes: number;
}

export interface FixedToolStringEnumParameter {
  readonly type: "string";
  readonly enum: readonly string[];
  readonly description?: string;
}

export interface FixedToolParameterSchema {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, FixedToolStringEnumParameter>>;
}

export interface FixedToolTemplateBody {
  readonly id: string;
  readonly nodeId: string;
  readonly version: number;
  readonly displayName: string;
  readonly purpose: string;
  readonly executableDigest: FixedToolDigest;
  readonly parameterSchema: FixedToolParameterSchema;
  readonly workingScope: string;
  readonly envAllowlist: readonly string[];
  readonly networkPolicy: "disabled";
  readonly outputLimit: number;
  readonly sideEffectClass: "local_output_only";
  readonly budget: FixedToolResourceBudget;
}

export interface FixedToolTemplate extends FixedToolTemplateBody {
  readonly digest: FixedToolDigest;
}

export interface FixedToolUsage {
  readonly files: number;
  readonly bytes: number;
  readonly readBytes: number;
  readonly outputBytes: number;
  readonly durationSeconds: number;
  readonly concurrent: number;
  readonly cpuMillicpu: number;
  readonly memoryMb: number;
  readonly processes: number;
}

export interface FixedToolArtifactValue {
  readonly schemaVersion: 1;
  readonly suite: FixedToolSuite;
  readonly status: "passed";
  readonly environmentKeys: readonly string[];
}

export interface FixedToolArtifact {
  readonly name: "fixed-suite-result.json";
  readonly bytes: number;
  readonly digest: FixedToolDigest;
  readonly value: FixedToolArtifactValue;
}

export interface FixedToolRunResult {
  readonly state: "succeeded" | "failed";
  readonly runId: string;
  readonly templateId: string;
  readonly templateDigest: FixedToolDigest;
  readonly executableDigest: FixedToolDigest;
  readonly suite: FixedToolSuite;
  readonly processId: number | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly stderr: string;
  readonly outputBytes: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly processGroupTerminated: boolean;
  readonly procObservationAvailable: boolean;
  readonly environment: Readonly<Record<string, string>>;
  readonly environmentKeys: readonly string[];
  readonly hostEnvironmentInherited: boolean;
  readonly shellInvocations: 0;
  readonly networkAccesses: 0;
  readonly workingDirectory: "fresh-isolated-temp";
  readonly workingDirectoryRemoved: boolean;
  readonly artifact: FixedToolArtifact | null;
  readonly usage: FixedToolUsage;
  readonly limits: {
    readonly outputLimit: number;
    readonly budget: FixedToolResourceBudget;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface FixedToolInspection {
  readonly templateId: string;
  readonly templateDigest: FixedToolDigest;
  readonly executableDigest: FixedToolDigest;
  readonly parameterSchema: FixedToolParameterSchema;
  readonly workingScope: string;
  readonly outputLimit: number;
  readonly budget: FixedToolResourceBudget;
  readonly sandbox: {
    readonly environment: Readonly<Record<string, string>>;
    readonly environmentPolicy: "empty";
    readonly hostEnvironmentInherited: false;
    readonly envAllowlist: readonly string[];
    readonly workingDirectory: "fresh-isolated-temp-per-run";
    readonly workingDirectoryRemovedAfterRun: true;
    readonly inheritedMounts: readonly string[];
    readonly dockerSocketPath: null;
    readonly shell: false;
    readonly shellInvocations: 0;
    readonly networkPolicy: "disabled";
    readonly processGroupIsolation: true;
    readonly timeoutTermination: "process-group-sigkill-on-linux";
    readonly outputCapture: "bounded";
    readonly procObservation: "available-on-linux" | "unavailable";
  };
}

export interface FixedToolRunnerOptions {
  readonly fixedSuitePath: string;
  readonly tmpRoot?: string;
}

export interface FixedToolRunnerStats {
  readonly registeredTemplates: number;
  readonly activeRuns: number;
  readonly totalSpawned: number;
}

interface WorkspaceScan {
  readonly files: number;
  readonly bytes: number;
}

interface ProcessObservation {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputBytes: number;
  readonly timedOut: boolean;
  readonly outputExceeded: boolean;
  readonly processGroupTerminated: boolean;
  readonly processId: number | null;
  readonly durationMs: number;
  readonly maxRssMb: number;
  readonly maxCpuSeconds: number;
  readonly procAvailable: boolean;
  readonly spawnError: string | null;
  readonly resourceBudgetExceeded: boolean;
}

interface RunInput {
  readonly template: FixedToolTemplate;
  readonly suite: FixedToolSuite;
  readonly runId: string;
  readonly runDir: string;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKING_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EMPTY_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_ENVIRONMENT_KEYS: readonly string[] = Object.freeze([]);
const WINDOWS_PLATFORM_ENVIRONMENT_KEYS = new Set([
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);
const BUDGET_KEYS = [
  "maxFiles",
  "maxBytes",
  "maxReadBytes",
  "maxOutputBytes",
  "maxDurationSeconds",
  "maxConcurrent",
  "cpuMillicpu",
  "memoryMb",
  "processes",
] as const;

export class FixedToolError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FixedToolError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDigest(value: unknown): value is FixedToolDigest {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function invalidTemplate(message: string): never {
  throw new FixedToolError("invalid_template", message, 400);
}

function invalidRequest(message: string): never {
  throw new FixedToolError("invalid_request", message, 400);
}

function invalidArguments(message: string): never {
  throw new FixedToolError("invalid_arguments", message, 400);
}

function toFixedToolError(error: unknown, code: string, status: number): FixedToolError {
  if (error instanceof FixedToolError) return error;
  return new FixedToolError(code, error instanceof Error ? error.message : "Unknown error", status);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function sha256Digest(bytes: Uint8Array | string): FixedToolDigest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) normalized[key] = canonicalize(value[key]);
    return normalized;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalTemplateDigest(
  template: FixedToolTemplateBody | FixedToolTemplate,
): FixedToolDigest {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (key !== "digest") body[key] = value;
  }
  return sha256Digest(canonicalJson(body));
}

export function withCanonicalTemplateDigest(template: FixedToolTemplateBody): FixedToolTemplate {
  return { ...template, digest: canonicalTemplateDigest(template) };
}

function validateParameterSchema(value: unknown): FixedToolParameterSchema {
  if (!isRecord(value)) invalidTemplate("parameterSchema must be an object");
  for (const key of Object.keys(value)) {
    if (!["type", "additionalProperties", "required", "properties"].includes(key)) {
      invalidTemplate(`parameterSchema.${key} is not allowed`);
    }
  }
  if (value.type !== "object" || value.additionalProperties !== false) {
    invalidTemplate("parameterSchema must be a closed object");
  }

  const required = value.required;
  if (!Array.isArray(required) || required.length !== 1 || required[0] !== "suite") {
    invalidTemplate("parameterSchema.required must contain only suite");
  }

  const properties = value.properties;
  if (!isRecord(properties)) invalidTemplate("parameterSchema.properties must be an object");
  for (const key of Object.keys(properties)) {
    if (key !== "suite") invalidTemplate(`parameterSchema.properties.${key} is not allowed`);
  }

  const suite = properties.suite;
  if (!isRecord(suite)) invalidTemplate("parameterSchema.properties.suite must be an object");
  for (const key of Object.keys(suite)) {
    if (!["type", "enum", "description"].includes(key)) {
      invalidTemplate(`parameterSchema.properties.suite.${key} is not allowed`);
    }
  }
  if (suite.type !== "string" || !Array.isArray(suite.enum) || suite.enum.length === 0) {
    invalidTemplate("suite must be a non-empty string enum");
  }

  const allowed: FixedToolSuite[] = [];
  for (const item of suite.enum) {
    if (
      typeof item !== "string" ||
      !(FIXED_TOOL_SUITES as readonly string[]).includes(item) ||
      allowed.includes(item as FixedToolSuite)
    ) {
      invalidTemplate("suite enum may only contain distinct unit and integration values");
    }
    allowed.push(item as FixedToolSuite);
  }

  const description = suite.description;
  if (description !== undefined && typeof description !== "string") {
    invalidTemplate("suite description must be a string");
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["suite"],
    properties: {
      suite: {
        type: "string",
        enum: allowed,
        ...(typeof description === "string" ? { description } : {}),
      },
    },
  };
}

function validateBudget(value: unknown): FixedToolResourceBudget {
  if (!isRecord(value)) invalidTemplate("budget must be an object");
  for (const key of Object.keys(value)) {
    if (!(BUDGET_KEYS as readonly string[]).includes(key)) {
      invalidTemplate(`budget.${key} is not allowed`);
    }
  }

  const maxFiles = value.maxFiles;
  if (!isIntegerInRange(maxFiles, 1, 64)) invalidTemplate("budget.maxFiles is out of range");
  const maxBytes = value.maxBytes;
  if (!isIntegerInRange(maxBytes, 1, 1_048_576)) invalidTemplate("budget.maxBytes is out of range");
  const maxReadBytes = value.maxReadBytes;
  if (!isIntegerInRange(maxReadBytes, 1, 1_048_576)) {
    invalidTemplate("budget.maxReadBytes is out of range");
  }
  const maxOutputBytes = value.maxOutputBytes;
  if (!isIntegerInRange(maxOutputBytes, 1, 65_536)) {
    invalidTemplate("budget.maxOutputBytes is out of range");
  }
  const maxDurationSeconds = value.maxDurationSeconds;
  if (!isIntegerInRange(maxDurationSeconds, 1, 300)) {
    invalidTemplate("budget.maxDurationSeconds is out of range");
  }
  const maxConcurrent = value.maxConcurrent;
  if (!isIntegerInRange(maxConcurrent, 1, 8)) {
    invalidTemplate("budget.maxConcurrent is out of range");
  }
  const cpuMillicpu = value.cpuMillicpu;
  if (!isIntegerInRange(cpuMillicpu, 1, 8_000)) {
    invalidTemplate("budget.cpuMillicpu is out of range");
  }
  const memoryMb = value.memoryMb;
  if (!isIntegerInRange(memoryMb, 1, 2_048)) {
    invalidTemplate("budget.memoryMb is out of range");
  }
  const processes = value.processes;
  if (!isIntegerInRange(processes, 1, 64)) invalidTemplate("budget.processes is out of range");

  return {
    maxFiles,
    maxBytes,
    maxReadBytes,
    maxOutputBytes,
    maxDurationSeconds,
    maxConcurrent,
    cpuMillicpu,
    memoryMb,
    processes,
  };
}

export function validateFixedToolTemplate(
  value: unknown,
  storedExecutableDigest: FixedToolDigest,
): FixedToolTemplate {
  if (!isRecord(value)) invalidTemplate("template must be an object");

  const templateKeys = [
    "id",
    "nodeId",
    "version",
    "digest",
    "displayName",
    "purpose",
    "executableDigest",
    "parameterSchema",
    "workingScope",
    "envAllowlist",
    "networkPolicy",
    "outputLimit",
    "sideEffectClass",
    "budget",
  ];
  for (const key of Object.keys(value)) {
    if (!templateKeys.includes(key)) invalidTemplate(`template.${key} is not allowed`);
  }

  const id = value.id;
  if (typeof id !== "string" || !IDENTIFIER_PATTERN.test(id)) invalidTemplate("id is invalid");
  const nodeId = value.nodeId;
  if (typeof nodeId !== "string" || !IDENTIFIER_PATTERN.test(nodeId)) {
    invalidTemplate("nodeId is invalid");
  }
  const version = value.version;
  if (!isIntegerInRange(version, 1, 1_000_000)) invalidTemplate("version is invalid");
  const digest = value.digest;
  if (!isDigest(digest)) invalidTemplate("digest is invalid");
  const displayName = value.displayName;
  if (typeof displayName !== "string" || displayName.length === 0 || displayName.length > 200) {
    invalidTemplate("displayName is invalid");
  }
  const purpose = value.purpose;
  if (typeof purpose !== "string" || purpose.length === 0 || purpose.length > 1_000) {
    invalidTemplate("purpose is invalid");
  }
  const executableDigest = value.executableDigest;
  if (!isDigest(executableDigest)) invalidTemplate("executableDigest is invalid");
  const parameterSchema = validateParameterSchema(value.parameterSchema);
  const workingScope = value.workingScope;
  if (typeof workingScope !== "string" || !WORKING_SCOPE_PATTERN.test(workingScope)) {
    invalidTemplate("workingScope is invalid");
  }

  const envAllowlist = value.envAllowlist;
  if (!Array.isArray(envAllowlist) || envAllowlist.length !== 0) {
    invalidTemplate("envAllowlist must be empty");
  }
  if (value.networkPolicy !== "disabled") {
    throw new FixedToolError("network_denied", "Fixed tools have no network permission", 400);
  }
  if (value.sideEffectClass !== "local_output_only") {
    invalidTemplate("sideEffectClass must be local_output_only");
  }
  const outputLimit = value.outputLimit;
  if (!isIntegerInRange(outputLimit, 1, 65_536)) invalidTemplate("outputLimit is out of range");
  const budget = validateBudget(value.budget);

  if (executableDigest !== storedExecutableDigest) {
    throw new FixedToolError(
      "executable_digest_mismatch",
      "Execution worker does not store executable bytes for this template",
      409,
    );
  }

  const template: FixedToolTemplate = {
    id,
    nodeId,
    version,
    digest,
    displayName,
    purpose,
    executableDigest,
    parameterSchema,
    workingScope,
    envAllowlist: [],
    networkPolicy: "disabled",
    outputLimit,
    sideEffectClass: "local_output_only",
    budget,
  };

  if (canonicalTemplateDigest(template) !== digest) {
    throw new FixedToolError(
      "template_digest_mismatch",
      "Template digest does not match its canonical contents",
      409,
    );
  }

  return template;
}

async function scanWorkspace(directory: string): Promise<WorkspaceScan> {
  const entries = await readdir(directory, { withFileTypes: true });
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new FixedToolError(
        "unexpected_workspace_entry",
        "Fixed suite workspace may not contain symlinks",
        500,
      );
    }
    if (entry.isDirectory()) {
      const nested = await scanWorkspace(entryPath);
      files += nested.files;
      bytes += nested.bytes;
      continue;
    }
    if (!entry.isFile()) {
      throw new FixedToolError(
        "unexpected_workspace_entry",
        "Fixed suite workspace contains an unsupported entry",
        500,
      );
    }
    const details = await stat(entryPath);
    files += 1;
    bytes += details.size;
  }
  return { files, bytes };
}

function parseArtifact(bytes: Buffer, expectedSuite: FixedToolSuite): FixedToolArtifact {
  if (bytes.byteLength > 65_536) {
    throw new FixedToolError("artifact_invalid", "Fixed suite artifact is too large", 500);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new FixedToolError("artifact_invalid", "Fixed suite artifact is not JSON", 500);
  }
  if (!isRecord(parsed)) {
    throw new FixedToolError("artifact_invalid", "Fixed suite artifact must be an object", 500);
  }
  if (
    parsed.schemaVersion !== 1 ||
    parsed.suite !== expectedSuite ||
    parsed.status !== "passed" ||
    !Array.isArray(parsed.environmentKeys)
  ) {
    throw new FixedToolError(
      "artifact_invalid",
      "Fixed suite artifact does not match its run",
      500,
    );
  }

  const environmentKeys: string[] = [];
  for (const key of parsed.environmentKeys) {
    if (typeof key !== "string") {
      throw new FixedToolError("artifact_invalid", "Artifact environment keys are invalid", 500);
    }
    environmentKeys.push(key);
  }

  return {
    name: "fixed-suite-result.json",
    bytes: bytes.byteLength,
    digest: sha256Digest(bytes),
    value: {
      schemaVersion: 1,
      suite: expectedSuite,
      status: "passed",
      environmentKeys,
    },
  };
}

function collectBudgetViolations(usage: FixedToolUsage, budget: FixedToolResourceBudget): string[] {
  const violations: string[] = [];
  if (usage.files > budget.maxFiles) violations.push("maxFiles");
  if (usage.bytes > budget.maxBytes) violations.push("maxBytes");
  if (usage.readBytes > budget.maxReadBytes) violations.push("maxReadBytes");
  if (usage.processes > budget.processes) violations.push("processes");
  if (usage.concurrent > budget.maxConcurrent) violations.push("maxConcurrent");
  return violations;
}

function unexpectedEnvironmentKeys(keys: readonly string[]): string[] {
  if (process.platform !== "win32") return [...keys];
  return keys.filter((key) => !WINDOWS_PLATFORM_ENVIRONMENT_KEYS.has(key));
}

function determineRunFailure(input: {
  readonly observation: ProcessObservation;
  readonly usage: FixedToolUsage;
  readonly outputLimit: number;
  readonly budget: FixedToolResourceBudget;
  readonly workspaceError: FixedToolError | null;
  readonly artifactError: FixedToolError | null;
  readonly artifact: FixedToolArtifact | null;
  readonly unexpectedEnvironment: readonly string[];
}): { readonly code: string; readonly message: string } | null {
  const { observation, usage, budget } = input;
  if (observation.spawnError !== null) {
    return { code: "spawn_failed", message: "Fixed suite process could not be started" };
  }
  if (observation.outputExceeded || usage.outputBytes > input.outputLimit) {
    return {
      code: "output_limit_exceeded",
      message: `Output exceeded ${input.outputLimit} bytes`,
    };
  }
  if (observation.timedOut || usage.durationSeconds > budget.maxDurationSeconds) {
    return {
      code: "wall_timeout",
      message: `Wall time exceeded ${budget.maxDurationSeconds} seconds`,
    };
  }
  if (
    observation.resourceBudgetExceeded ||
    usage.memoryMb > budget.memoryMb ||
    usage.cpuMillicpu > budget.cpuMillicpu
  ) {
    return { code: "budget_exhausted", message: "CPU or memory budget exceeded" };
  }
  if (observation.exitCode !== 0) {
    return { code: "nonzero_exit", message: "Fixed suite exited unsuccessfully" };
  }
  if (input.workspaceError !== null) {
    return { code: input.workspaceError.code, message: input.workspaceError.message };
  }
  if (input.unexpectedEnvironment.length > 0) {
    return {
      code: "environment_violation",
      message: "Fixed suite observed environment variables outside the platform baseline",
    };
  }
  const violations = collectBudgetViolations(usage, budget);
  if (violations.length > 0) {
    return { code: "budget_exhausted", message: `Budget exceeded: ${violations.join(", ")}` };
  }
  if (input.artifactError !== null) {
    return { code: input.artifactError.code, message: input.artifactError.message };
  }
  if (input.artifact === null) {
    return { code: "missing_artifact", message: "Fixed suite did not emit its result artifact" };
  }
  return null;
}

function emptyProcessObservation(
  durationMs: number,
  spawnError: string,
  processId: number | null = null,
): ProcessObservation {
  return {
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    outputBytes: 0,
    timedOut: false,
    outputExceeded: false,
    processGroupTerminated: false,
    processId,
    durationMs,
    maxRssMb: 0,
    maxCpuSeconds: 0,
    procAvailable: false,
    spawnError,
    resourceBudgetExceeded: false,
  };
}

async function sampleProcess(
  pid: number,
): Promise<{ readonly rssMb: number; readonly cpuSeconds: number } | null> {
  try {
    const [status, stat] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const rssLine = status.split("\n").find((line) => line.startsWith("VmRSS:"));
    const rssKb = rssLine === undefined ? 0 : Number.parseInt(rssLine.replace(/[^0-9]/g, ""), 10);
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return null;
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const utime = Number.parseInt(fields[11] ?? "0", 10);
    const stime = Number.parseInt(fields[12] ?? "0", 10);
    if (!Number.isFinite(rssKb) || !Number.isFinite(utime) || !Number.isFinite(stime)) {
      return null;
    }
    return { rssMb: rssKb / 1024, cpuSeconds: (utime + stime) / 100 };
  } catch {
    return null;
  }
}

export class FixedToolRunner {
  readonly executableDigest: FixedToolDigest;

  readonly #executableBytes: Buffer;
  readonly #tmpRoot: string;
  readonly #templates = new Map<string, FixedToolTemplate>();
  readonly #active = new Map<string, number>();
  readonly #children = new Set<ChildProcess>();
  #totalSpawned = 0;

  private constructor(executableBytes: Buffer, tmpRoot: string) {
    this.#executableBytes = executableBytes;
    this.#tmpRoot = tmpRoot;
    this.executableDigest = sha256Digest(executableBytes);
  }

  static async create(options: FixedToolRunnerOptions): Promise<FixedToolRunner> {
    let executableBytes: Buffer;
    try {
      executableBytes = await readFile(options.fixedSuitePath);
    } catch {
      throw new FixedToolError(
        "fixed_suite_unavailable",
        "Fixed suite executable could not be loaded",
        500,
      );
    }
    if (executableBytes.byteLength === 0) {
      throw new FixedToolError("fixed_suite_unavailable", "Fixed suite executable is empty", 500);
    }
    const tmpRoot = options.tmpRoot ?? tmpdir();
    await mkdir(tmpRoot, { recursive: true });
    return new FixedToolRunner(executableBytes, tmpRoot);
  }

  register(input: unknown): FixedToolTemplate {
    const template = validateFixedToolTemplate(input, this.executableDigest);
    const existing = this.#templates.get(template.id);
    if (existing !== undefined) {
      if (existing.digest !== template.digest) {
        throw new FixedToolError(
          "template_reauthorization_required",
          "A different template with this id already requires reauthorization",
          409,
        );
      }
      return existing;
    }
    this.#templates.set(template.id, template);
    return template;
  }

  inspect(templateId: unknown): FixedToolInspection {
    if (typeof templateId !== "string") invalidRequest("templateId must be a string");
    const template = this.#templates.get(templateId);
    if (template === undefined) {
      throw new FixedToolError("template_not_found", "Template is not registered", 404);
    }

    return {
      templateId: template.id,
      templateDigest: template.digest,
      executableDigest: template.executableDigest,
      parameterSchema: template.parameterSchema,
      workingScope: template.workingScope,
      outputLimit: template.outputLimit,
      budget: template.budget,
      sandbox: {
        environment: EMPTY_ENVIRONMENT,
        environmentPolicy: "empty",
        hostEnvironmentInherited: false,
        envAllowlist: template.envAllowlist,
        workingDirectory: "fresh-isolated-temp-per-run",
        workingDirectoryRemovedAfterRun: true,
        inheritedMounts: [],
        dockerSocketPath: null,
        shell: false,
        shellInvocations: 0,
        networkPolicy: "disabled",
        processGroupIsolation: true,
        timeoutTermination: "process-group-sigkill-on-linux",
        outputCapture: "bounded",
        procObservation: process.platform === "linux" ? "available-on-linux" : "unavailable",
      },
    };
  }

  getStats(): FixedToolRunnerStats {
    let activeRuns = 0;
    for (const count of this.#active.values()) activeRuns += count;
    return {
      registeredTemplates: this.#templates.size,
      activeRuns,
      totalSpawned: this.#totalSpawned,
    };
  }

  async close(): Promise<void> {
    for (const child of this.#children) {
      const pid = child.pid;
      if (pid === undefined) continue;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-pid, "SIGKILL");
      } catch {
        // The child or its process group already exited.
      }
    }
    this.#children.clear();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async execute(input: unknown): Promise<FixedToolRunResult> {
    const { template, suite } = this.#resolveExecution(input);
    const active = (this.#active.get(template.id) ?? 0) + 1;
    if (active > template.budget.maxConcurrent) {
      throw new FixedToolError(
        "concurrency_limit_exceeded",
        "Concurrent execution budget exhausted",
        429,
      );
    }
    this.#active.set(template.id, active);

    const runId = randomUUID();
    let runDir: string | null = null;
    let cleanupFailed = false;
    let result: FixedToolRunResult | undefined;

    try {
      runDir = await mkdtemp(join(this.#tmpRoot, "run-"));
      this.#totalSpawned += 1;
      result = await this.#performRun({ template, suite, runId, runDir }, active);
    } finally {
      const remaining = (this.#active.get(template.id) ?? 1) - 1;
      if (remaining <= 0) this.#active.delete(template.id);
      else this.#active.set(template.id, remaining);

      if (runDir !== null) {
        try {
          await rm(runDir, { recursive: true, force: true });
        } catch {
          cleanupFailed = true;
        }
      }
    }

    if (result === undefined) {
      throw new FixedToolError("execution_failed", "Fixed suite produced no result", 500);
    }
    if (cleanupFailed) {
      return {
        ...result,
        state: "failed",
        workingDirectoryRemoved: false,
        error: {
          code: "cleanup_failed",
          message: "Isolated working directory could not be removed",
        },
      };
    }
    return result;
  }

  #resolveExecution(input: unknown): {
    readonly template: FixedToolTemplate;
    readonly suite: FixedToolSuite;
  } {
    if (!isRecord(input)) invalidRequest("Execution request must be an object");
    for (const key of Object.keys(input)) {
      if (!["templateId", "templateDigest", "arguments"].includes(key)) {
        invalidRequest(`Execution request field ${key} is not allowed`);
      }
    }
    const templateId = input.templateId;
    const templateDigest = input.templateDigest;
    if (typeof templateId !== "string") invalidRequest("templateId must be a string");
    if (typeof templateDigest !== "string") invalidRequest("templateDigest must be a string");

    const template = this.#templates.get(templateId);
    if (template === undefined) {
      throw new FixedToolError("template_not_found", "Template is not registered", 404);
    }
    if (template.digest !== templateDigest) {
      throw new FixedToolError(
        "template_digest_mismatch",
        "Request does not bind the registered template digest",
        409,
      );
    }

    const args = input.arguments;
    if (!isRecord(args)) invalidArguments("arguments must be an object");
    for (const key of Object.keys(args)) {
      if (key !== "suite") invalidArguments(`Argument ${key} is not allowed`);
    }
    const suiteValue = args.suite;
    if (typeof suiteValue !== "string") invalidArguments("suite is required");
    const definition = template.parameterSchema.properties.suite;
    if (definition === undefined || !definition.enum.includes(suiteValue)) {
      invalidArguments("suite is not permitted by the registered template");
    }

    return { template, suite: suiteValue as FixedToolSuite };
  }

  async #performRun(input: RunInput, concurrent: number): Promise<FixedToolRunResult> {
    const executablePath = join(input.runDir, ".fixed-suite.mjs");
    await writeFile(executablePath, this.#executableBytes, { flag: "wx", mode: 0o400 });
    const observation = await this.#observeProcess(input, executablePath);
    const outputLimit = Math.min(input.template.outputLimit, input.template.budget.maxOutputBytes);

    let workspace: WorkspaceScan = { files: 0, bytes: 0 };
    let workspaceError: FixedToolError | null = null;
    try {
      workspace = await scanWorkspace(input.runDir);
    } catch (error) {
      workspaceError = toFixedToolError(error, "workspace_invalid", 500);
    }

    let artifact: FixedToolArtifact | null = null;
    let artifactError: FixedToolError | null = null;
    try {
      const bytes = await readFile(join(input.runDir, "fixed-suite-result.json"));
      artifact = parseArtifact(bytes, input.suite);
    } catch (error) {
      if (!isFileNotFound(error)) {
        artifactError = toFixedToolError(error, "artifact_invalid", 500);
      }
    }

    const usage: FixedToolUsage = {
      files: workspace.files,
      bytes: workspace.bytes,
      readBytes: (artifact?.bytes ?? 0) + observation.outputBytes,
      outputBytes: observation.outputBytes,
      durationSeconds: observation.durationMs / 1000,
      concurrent,
      cpuMillicpu: Math.round(observation.maxCpuSeconds * 1000),
      memoryMb: Math.ceil(observation.maxRssMb),
      processes: observation.processId === null ? 0 : 1,
    };

    const observedEnvironmentKeys = artifact?.value.environmentKeys ?? EMPTY_ENVIRONMENT_KEYS;
    const disallowedEnvironmentKeys = unexpectedEnvironmentKeys(observedEnvironmentKeys);

    const failure = determineRunFailure({
      observation,
      usage,
      outputLimit,
      budget: input.template.budget,
      workspaceError,
      artifactError,
      artifact,
      unexpectedEnvironment: disallowedEnvironmentKeys,
    });

    const base = {
      runId: input.runId,
      templateId: input.template.id,
      templateDigest: input.template.digest,
      executableDigest: input.template.executableDigest,
      suite: input.suite,
      processId: observation.processId,
      exitCode: observation.exitCode,
      signal: observation.signal,
      output: observation.stdout,
      stderr: observation.stderr,
      outputBytes: observation.outputBytes,
      durationMs: observation.durationMs,
      timedOut: observation.timedOut,
      processGroupTerminated: observation.processGroupTerminated,
      procObservationAvailable: observation.procAvailable,
      environment: EMPTY_ENVIRONMENT,
      environmentKeys: observedEnvironmentKeys,
      hostEnvironmentInherited: observedEnvironmentKeys.length > 0,
      shellInvocations: 0 as const,
      networkAccesses: 0 as const,
      workingDirectory: "fresh-isolated-temp" as const,
      workingDirectoryRemoved: true,
      usage,
      limits: { outputLimit, budget: { ...input.template.budget } },
    } satisfies Omit<FixedToolRunResult, "state" | "artifact" | "error">;

    if (failure !== null) {
      return {
        ...base,
        state: "failed",
        artifact,
        error: { code: failure.code, message: failure.message },
      };
    }
    if (artifact === null) {
      return {
        ...base,
        state: "failed",
        artifact: null,
        error: { code: "missing_artifact", message: "Fixed suite did not emit its artifact" },
      };
    }
    return { ...base, state: "succeeded", artifact };
  }

  async #observeProcess(input: RunInput, executablePath: string): Promise<ProcessObservation> {
    const startedAt = Date.now();
    const outputLimit = Math.min(input.template.outputLimit, input.template.budget.maxOutputBytes);
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [executablePath, input.suite], {
        cwd: input.runDir,
        env: {},
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      return emptyProcessObservation(Date.now() - startedAt, "spawn failed");
    }

    this.#children.add(child);
    const processId = child.pid ?? null;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (stdout === null || stderr === null) {
      this.#children.delete(child);
      try {
        child.kill("SIGKILL");
      } catch {
        // The process already exited.
      }
      return emptyProcessObservation(Date.now() - startedAt, "stdio unavailable", processId);
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let capturedBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let processGroupTerminated = false;
    let maxRssMb = 0;
    let maxCpuSeconds = 0;
    let procAvailable = false;
    let resourceBudgetExceeded = false;
    let spawnError: string | null = null;
    let sampling = false;

    const terminate = (signal: NodeJS.Signals): boolean => {
      if (child.exitCode !== null || child.signalCode !== null) return false;
      if (process.platform !== "win32" && processId !== null) {
        try {
          process.kill(-processId, signal);
          processGroupTerminated = true;
          return true;
        } catch {
          // Fall back to the direct child handle.
        }
      }
      try {
        child.kill(signal);
        return true;
      } catch {
        return false;
      }
    };

    const collect =
      (chunks: Buffer[]) =>
      (chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        const remaining = Math.max(0, outputLimit - capturedBytes);
        if (remaining > 0) {
          const piece = chunk.subarray(0, remaining);
          chunks.push(piece);
          capturedBytes += piece.byteLength;
        }
        if (outputBytes > outputLimit && !outputExceeded) {
          outputExceeded = true;
          terminate("SIGKILL");
        }
      };
    stdout.on("data", collect(stdoutChunks));
    stderr.on("data", collect(stderrChunks));

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate("SIGKILL");
    }, input.template.budget.maxDurationSeconds * 1000);
    timeout.unref?.();

    const inspectProc = (): void => {
      if (processId === null || sampling) return;
      sampling = true;
      void sampleProcess(processId)
        .then((sample) => {
          sampling = false;
          if (sample === null) return;
          procAvailable = true;
          maxRssMb = Math.max(maxRssMb, sample.rssMb);
          maxCpuSeconds = Math.max(maxCpuSeconds, sample.cpuSeconds);
          if (
            !resourceBudgetExceeded &&
            (sample.rssMb > input.template.budget.memoryMb ||
              sample.cpuSeconds * 1000 > input.template.budget.cpuMillicpu)
          ) {
            resourceBudgetExceeded = true;
            terminate("SIGKILL");
          }
        })
        .catch(() => {
          sampling = false;
        });
    };
    const procTimer = process.platform === "linux" ? setInterval(inspectProc, 25) : null;
    procTimer?.unref?.();

    const exit = await new Promise<{
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve) => {
      let settled = false;
      child.once("error", (error) => {
        spawnError = error instanceof Error ? error.message : "spawn failed";
        if (!settled) {
          settled = true;
          resolve({ exitCode: null, signal: null });
        }
      });
      child.once("close", (code, signal) => {
        if (!settled) {
          settled = true;
          resolve({ exitCode: code, signal });
        }
      });
    });

    clearTimeout(timeout);
    if (procTimer !== null) clearInterval(procTimer);
    this.#children.delete(child);

    if (process.platform !== "win32" && processId !== null) {
      try {
        process.kill(-processId, "SIGKILL");
        processGroupTerminated = true;
      } catch {
        // No process group remains.
      }
    }

    return {
      exitCode: exit.exitCode,
      signal: exit.signal,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      outputBytes,
      timedOut,
      outputExceeded,
      processGroupTerminated,
      processId,
      durationMs: Date.now() - startedAt,
      maxRssMb,
      maxCpuSeconds,
      procAvailable,
      spawnError,
      resourceBudgetExceeded,
    };
  }
}

export async function createFixedToolRunner(
  options: FixedToolRunnerOptions,
): Promise<FixedToolRunner> {
  return FixedToolRunner.create(options);
}
