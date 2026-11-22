import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { command, newIdempotencyKey, sha256Hex, uuidv7 } from "../../support/us2/harness";

/**
 * T048 / US1 / QS-01.
 *
 * Static assertions pin the HTTP contract used by the personal-task, Run,
 * approval and artifact surfaces. Live assertions exercise the same surface as
 * a black box. Until the Runner from QS-01 exists, live failures are explicit
 * "[US1 missing behavior]" or "[US1 setup missing]" errors rather than a
 * module-resolution failure.
 *
 * Live fixture required by QS-01: one owner session, a local Runner and an
 * enabled `faux` model profile. The single-user self-approval exception must be
 * enabled before the startRun cases are exercised.
 */

const CONTRACT_PATH = fileURLToPath(
  new URL(
    "../../../specs/001-agent-federated-collaboration/contracts/runner-api.openapi.yaml",
    import.meta.url,
  ),
);
const CONTRACT_README_PATH = fileURLToPath(
  new URL("../../../specs/001-agent-federated-collaboration/contracts/README.md", import.meta.url),
);

const spec = readFileSync(CONTRACT_PATH, "utf8");
const contractReadme = readFileSync(CONTRACT_README_PATH, "utf8");

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_RUN_STATES = new Set([
  "created",
  "running",
  "waiting_approval",
  "stopping",
  "needs_confirmation",
]);
const RUN_STATES = [
  "created",
  "running",
  "waiting_approval",
  "stopping",
  "technical_complete",
  "failed",
  "cancelled",
  "needs_confirmation",
];
const APPROVAL_STATES = ["pending", "approved", "rejected", "expired", "invalidated"];

function contractBlock(source: string, start: string, end?: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) {
    throw new Error(`[US1 contract missing] Could not find contract block starting with ${start}`);
  }
  if (end === undefined) {
    return source.slice(startIndex);
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) {
    throw new Error(`[US1 contract missing] Could not find contract block ending with ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

function operationBlock(operationId: string): string {
  const marker = `operationId: ${operationId}`;
  const startIndex = spec.indexOf(marker);
  if (startIndex < 0) {
    throw new Error(`[US1 contract missing] operationId ${operationId} is not published`);
  }
  const nextOperation = spec.indexOf("operationId:", startIndex + marker.length);
  return spec.slice(startIndex, nextOperation < 0 ? spec.length : nextOperation);
}

const SCHEMAS_START = spec.indexOf("  schemas:");
if (SCHEMAS_START < 0) {
  throw new Error("[US1 contract missing] runner-api.openapi.yaml has no components.schemas");
}
const schemaSource = spec.slice(SCHEMAS_START);

function schemaBlock(name: string, nextName: string): string {
  return contractBlock(schemaSource, `    ${name}:\n`, `    ${nextName}:\n`);
}

const createWorkspace = contractBlock(spec, "    CreateWorkspace:\n", "    Selection:\n");
const runCommand = contractBlock(spec, "    RunCommand:\n", "    QueueAction:\n");
const approvalDecision = contractBlock(spec, "    ApprovalDecision:\n", "    Conclusion:\n");
const workspaceSchema = schemaBlock("Workspace", "Run");
const runSchema = schemaBlock("Run", "Approval");
const approvalSchema = schemaBlock("Approval", "ApprovalList");
const approvalListSchema = schemaBlock("ApprovalList", "Conclusion");
const artifactMetadata = schemaBlock("ArtifactMetadata", "Digest");
const digestSchema = schemaBlock("Digest", "Command");
const problemSchema = schemaBlock("Problem", "MemberRole");

describe("US1 personal Run API contract (static)", () => {
  it("publishes personal-task creation without requiring a team", () => {
    const createPersonal = operationBlock("createPersonalTask");

    expect(createPersonal).toContain('"201": { $ref: "#/components/responses/Workspace" }');
    expect(createPersonal).toContain('{ $ref: "#/components/parameters/IdempotencyKey" }');
    expect(createPersonal).toContain('{ $ref: "#/components/requestBodies/CreateWorkspace" }');

    expect(createWorkspace).toMatch(/required: \[name, runnerId, agentProfileId\]/);
    expect(createWorkspace).not.toMatch(/required: \[[^\]]*\bteamId\b[^\]]*\]/);
    expect(createWorkspace).toContain("teamId: { type: string, format: uuid }");

    expect(workspaceSchema).toMatch(
      /required: \[id, kind, ownerId, runnerId, name, status, revision, currentOperator\]/,
    );
    expect(workspaceSchema).toContain("kind: { type: string, enum: [personal, shared] }");
  });

  it("publishes 202 Run acceptance, idempotent replay and epoch fencing", () => {
    const startRun = operationBlock("startRun");
    const runAccepted = contractBlock(spec, "    RunAccepted:\n", "    Accepted:\n");

    expect(startRun).toContain('"202": { $ref: "#/components/responses/RunAccepted" }');
    expect(startRun).toContain('{ $ref: "#/components/requestBodies/RunCommand" }');
    expect(runAccepted).toContain('schema: { $ref: "#/components/schemas/Run" }');
    expect(runAccepted).toContain("不表示 Agent 或工具已完成");

    expect(runCommand).toMatch(/required: \[operatorEpoch\]/);
    expect(runCommand).toContain("operatorEpoch: { type: integer, format: int64, minimum: 1 }");
    expect(runSchema).toMatch(
      /required: \[id, workspaceId, state, operatorEpoch, contextSnapshotId\]/,
    );
    expect(runSchema).toContain(`enum: [${RUN_STATES.join(", ")}]`);

    expect(contractReadme).toMatch(
      /相同幂等键只恢复首次结果，不同载荷摘要复用该键返回 `revision_conflict`/,
    );
    expect(contractReadme).toMatch(/\| 409 \| `revision_conflict` \|/);
    expect(contractReadme).toMatch(/\| 409 \| `operator_changed` \|/);
    expect(contractReadme).toMatch(/\| 409 \| `task_active` \|/);
  });

  it("publishes approval list/detail/decision and artifact SHA-256 structures", () => {
    const listApprovals = operationBlock("listVisibleApprovals");
    const getApproval = operationBlock("getApproval");
    const decideApproval = operationBlock("decideApproval");
    const uploadArtifact = operationBlock("uploadReferenceArtifact");
    const downloadArtifact = operationBlock("downloadArtifact");

    expect(listApprovals).toContain('"200": { $ref: "#/components/responses/ApprovalList" }');
    expect(getApproval).toContain('"200": { $ref: "#/components/responses/Approval" }');
    expect(decideApproval).toContain('{ $ref: "#/components/requestBodies/ApprovalDecision" }');
    expect(decideApproval).toContain('"200": { $ref: "#/components/responses/Approval" }');

    expect(approvalSchema).toMatch(
      /required: \[id, actionProposal, requesterId, requiredApproverPolicy, policyRevision, state, expiresAt\]/,
    );
    expect(approvalSchema).toContain(`enum: [${APPROVAL_STATES.join(", ")}]`);
    expect(approvalSchema).toMatch(
      /required: \[toolName, displayArgs, secretRefs, actionDigest, purpose, impact, risk\]/,
    );
    expect(approvalSchema).toContain("description: 完整语义参数及明确脱敏占位，不含秘密值");
    expect(approvalListSchema).toMatch(/required: \[items\]/);
    expect(approvalListSchema).toContain("additionalProperties: false");
    expect(approvalDecision).toMatch(/required: \[decision, actionDigest\]/);
    expect(approvalDecision).toContain("enum: [approved, rejected]");
    expect(approvalDecision).toContain('actionDigest: { $ref: "#/components/schemas/Digest" }');

    expect(digestSchema).toContain("pattern: '^sha256:[0-9a-f]{64}$'");
    expect(uploadArtifact).toContain("multipart/form-data");
    expect(uploadArtifact).toMatch(/required: \[metadata, content\]/);
    expect(uploadArtifact).toContain('"201": { $ref: "#/components/responses/Object" }');
    expect(downloadArtifact).toContain("application/octet-stream");
    expect(downloadArtifact).toContain("支持 Range 和摘要校验");
    expect(artifactMetadata).toMatch(
      /required: \[name, mediaType, size, sha256, kind, sourceSummary\]/,
    );
    expect(artifactMetadata).toContain('sha256: { $ref: "#/components/schemas/Digest" }');
    expect(artifactMetadata).toContain("enum: [reference]");
    expect(artifactMetadata).toContain("additionalProperties: false");
  });

  it("publishes redacted RFC 9457 problems and the QS-01 error codes", () => {
    expect(problemSchema).toMatch(/required: \[type, title, status, code, detail, retryable\]/);
    expect(problemSchema).not.toContain("stack");
    expect(spec).toContain("application/problem+json");
    expect(spec).toContain("脱敏的标准错误");
    expect(contractReadme).toContain("任意错误响应都必须先脱敏");
    expect(contractReadme).toMatch(/\| 400 \| `invalid_request` \|/);
    expect(contractReadme).toMatch(/\| 404 \| `not_found` \|/);
  });
});

interface JsonRecord {
  [key: string]: unknown;
}

interface ApiResult {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

interface RawResult {
  status: number;
  headers: Headers;
  bytes: Buffer;
  text: string;
}

interface CallOptions {
  body?: JsonRecord | FormData;
  headers?: Record<string, string>;
  idempotencyKey?: string | null;
  token?: string | null;
}

interface LiveFixture {
  ownerId: string;
  runnerId: string;
  agentProfileId: string;
}

interface PersonalTaskFixture {
  workspaceId: string;
  workspace: JsonRecord;
  name: string;
}

let fixturePromise: Promise<LiveFixture> | undefined;

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function apiBaseUrl(): string {
  const value = firstEnv("UNSPOOL_RUNNER_API_URL", "UNSPOOL_BASE_URL");
  if (!value) {
    throw new Error(
      "[US1 missing behavior] UNSPOOL_RUNNER_API_URL is not set. " +
        "Start the Stable Runner described by quickstart QS-01 (T071-T080) and set, for example, " +
        "UNSPOOL_RUNNER_API_URL=https://localhost:8443/v1.",
    );
  }
  return value.replace(/\/+$/, "");
}

function ownerToken(): string {
  const value = firstEnv("UNSPOOL_US1_OWNER_TOKEN", "US1_OWNER_TOKEN");
  if (!value) {
    throw new Error(
      "[US1 setup missing] UNSPOOL_US1_OWNER_TOKEN is not set. " +
        "Prepare the single-owner QS-01 session before running this contract test.",
    );
  }
  return value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function truncate(value: string, maxLength = 500): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

async function fetchResponse(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const baseUrl = apiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };

  if (options.token !== null) {
    headers.Authorization = `Bearer ${options.token ?? ownerToken()}`;
  }

  let body: string | FormData | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (method !== "GET" && method !== "HEAD") {
    const idempotencyKey =
      options.idempotencyKey === null ? undefined : (options.idempotencyKey ?? newIdempotencyKey());
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
  }

  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `[US1 missing behavior] Runner API is unreachable at ${url}. ` +
        "Start the Stable Runner from quickstart QS-01 and implement T071-T080. " +
        `Original error: ${describeError(error)}`,
    );
  }
}

async function jsonApi(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<ApiResult> {
  const response = await fetchResponse(method, path, options);
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, headers: response.headers, body, text };
}

async function rawApi(method: string, path: string, options: CallOptions = {}): Promise<RawResult> {
  const response = await fetchResponse(method, path, {
    ...options,
    headers: { Accept: "application/octet-stream", ...(options.headers ?? {}) },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    bytes,
    text: bytes.toString("utf8"),
  };
}

function expectStatus<T extends { status: number; text: string }>(
  result: T,
  expected: number | number[],
  action: string,
): T {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(
      `[US1 contract mismatch] ${action} expected HTTP ${expectedStatuses.join("/")} ` +
        `but received ${result.status}: ${truncate(result.text)}`,
    );
  }
  return result;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(
      `[US1 contract mismatch] Expected ${label} to be a JSON object, got ${truncate(safeJson(value))}`,
    );
  }
  return value;
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function idOf(record: JsonRecord, key = "id"): string {
  const direct = optionalString(record, key);
  if (direct) {
    return direct;
  }
  for (const nestedKey of [
    "workspace",
    "run",
    "artifact",
    "approval",
    "principal",
    "profile",
    "data",
  ]) {
    const nested = record[nestedKey];
    if (isRecord(nested)) {
      const value = optionalString(nested, key);
      if (value) {
        return value;
      }
    }
  }
  throw new Error(
    `[US1 contract mismatch] Entity does not expose ${key}: ${truncate(safeJson(record))}`,
  );
}

function entityOf(body: unknown, key: string): JsonRecord {
  const record = asRecord(body, key);
  const direct = record[key];
  if (isRecord(direct)) {
    return direct;
  }
  for (const wrapper of ["data", "result", "resource", "value"]) {
    const nested = record[wrapper];
    if (isRecord(nested)) {
      const nestedEntity = nested[key];
      return isRecord(nestedEntity) ? nestedEntity : nested;
    }
  }
  return record;
}

function arrayFrom(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value, "collection");
  for (const key of [...keys, "items", "data"]) {
    const entry = record[key];
    if (Array.isArray(entry)) {
      return entry;
    }
    if (isRecord(entry)) {
      for (const nestedKey of ["items", "data", "results"]) {
        const nested = entry[nestedKey];
        if (Array.isArray(nested)) {
          return nested;
        }
      }
    }
  }
  throw new Error(
    `[US1 contract mismatch] Response does not contain a collection: ${truncate(safeJson(value))}`,
  );
}

function expectNoInternalDetails(text: string): void {
  expect(text).not.toMatch(/\.(?:ts|js):\d+/);
  expect(text).not.toMatch(/node_modules/);
  expect(text).not.toMatch(/\bstack\b/i);
  expect(text).not.toMatch(/(?:^|\s)at\s+[\w.<>]+\s*\(/);
}

function expectProblem(
  result: ApiResult,
  status: number,
  code: string,
  action: string,
): JsonRecord {
  expectStatus(result, status, action);
  expect(result.headers.get("content-type") ?? "").toContain("application/problem+json");

  const problem = asRecord(result.body, "problem");
  expect(problem.status).toBe(status);
  expect(problem.code).toBe(code);
  expect(problem.retryable).toBe(false);
  expect(typeof problem.type).toBe("string");
  expect(problem.type as string).toMatch(/^https?:\/\//);
  expect(typeof problem.title).toBe("string");
  expect((problem.title as string).length).toBeGreaterThan(0);
  expect(typeof problem.detail).toBe("string");
  expect((problem.detail as string).length).toBeGreaterThan(0);
  expectNoInternalDetails(result.text);
  return problem;
}

function revisionOf(workspace: JsonRecord): number {
  const revision = workspace.revision;
  if (typeof revision !== "number") {
    throw new Error(
      `[US1 contract mismatch] Workspace does not expose a numeric revision: ${truncate(safeJson(workspace))}`,
    );
  }
  return revision;
}

function operatorEpochOf(workspace: JsonRecord): number {
  const control = asRecord(workspace.currentOperator, "workspace.currentOperator");
  const epoch = control.operatorEpoch;
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 1) {
    throw new Error(
      `[US1 contract mismatch] Workspace currentOperator.operatorEpoch must be a positive integer: ${truncate(safeJson(workspace.currentOperator))}`,
    );
  }
  return epoch;
}

function uniqueName(prefix: string): string {
  const suffix = `${Date.now().toString(36)}-${uuidv7().slice(0, 8)}`;
  return `${prefix} ${suffix}`.slice(0, 50);
}

async function discoverRunnerId(): Promise<string> {
  const result = expectStatus(await jsonApi("GET", "/runners"), 200, "listing runners");
  const runners = arrayFrom(result.body, "runners").map((entry) => asRecord(entry, "runner"));
  const runner = runners.find((entry) => {
    const status = entry.status;
    return status === undefined || status === "available";
  });
  if (!runner) {
    throw new Error(
      "[US1 setup missing] No available local Runner is visible. " +
        "Configure the Runner described by QS-01 or set UNSPOOL_US1_RUNNER_ID.",
    );
  }
  return idOf(runner);
}

async function discoverAgentProfileId(runnerId: string): Promise<string> {
  const result = expectStatus(
    await jsonApi("GET", `/runners/${runnerId}/model-profiles`),
    200,
    "listing model profiles",
  );
  const profiles = arrayFrom(result.body, "modelProfiles", "profiles").map((entry) =>
    asRecord(entry, "model profile"),
  );
  const fauxProfile = profiles.find((profile) => {
    if (profile.enabled === false) {
      return false;
    }
    if (profile.provider === "faux") {
      return true;
    }
    return typeof profile.model === "string" && profile.model.toLowerCase().includes("faux");
  });
  if (!fauxProfile) {
    throw new Error(
      "[US1 setup missing] No enabled faux model profile is visible. " +
        "QS-01 requires a local Runner with a faux model; set UNSPOOL_US1_AGENT_PROFILE_ID if needed.",
    );
  }
  const profileId =
    optionalString(fauxProfile, "profileId") ??
    optionalString(fauxProfile, "id") ??
    (isRecord(fauxProfile.profile) ? optionalString(fauxProfile.profile, "id") : undefined);
  if (!profileId) {
    throw new Error(
      `[US1 contract mismatch] Model profile does not expose an id: ${truncate(safeJson(fauxProfile))}`,
    );
  }
  return profileId;
}

async function resolveLiveFixture(): Promise<LiveFixture> {
  const me = expectStatus(await jsonApi("GET", "/me"), 200, "discovering the owner principal");
  const principal = entityOf(me.body, "principal");
  const ownerId =
    optionalString(principal, "id") ??
    optionalString(principal, "userId") ??
    optionalString(principal, "principalId") ??
    optionalString(principal, "actorId");
  if (!ownerId) {
    throw new Error(
      `[US1 contract mismatch] /me did not return a principal id: ${truncate(me.text)}`,
    );
  }

  const runnerId = firstEnv("UNSPOOL_US1_RUNNER_ID", "US1_RUNNER_ID") ?? (await discoverRunnerId());
  const agentProfileId =
    firstEnv("UNSPOOL_US1_AGENT_PROFILE_ID", "US1_AGENT_PROFILE_ID") ??
    (await discoverAgentProfileId(runnerId));

  return { ownerId, runnerId, agentProfileId };
}

function liveFixture(): Promise<LiveFixture> {
  fixturePromise ??= resolveLiveFixture();
  return fixturePromise;
}

async function createPersonalTask(prefix: string): Promise<PersonalTaskFixture> {
  const fixture = await liveFixture();
  const name = uniqueName(prefix);
  const body = command({
    name,
    goal: "Complete the QS-01 personal task without a team",
    completionCriteria: "A Markdown report and code diff are saved as artifacts",
    runnerId: fixture.runnerId,
    agentProfileId: fixture.agentProfileId,
  });
  const result = expectStatus(
    await jsonApi("POST", "/personal-tasks", { body }),
    201,
    `creating personal task ${prefix}`,
  );
  const workspace = entityOf(result.body, "workspace");
  return { workspaceId: idOf(workspace), workspace, name };
}

async function listRuns(workspaceId: string): Promise<JsonRecord[]> {
  const result = expectStatus(
    await jsonApi("GET", `/workspaces/${workspaceId}/runs`),
    200,
    "listing workspace runs",
  );
  return arrayFrom(result.body, "runs").map((entry) => asRecord(entry, "run"));
}

function isActiveRun(run: JsonRecord): boolean {
  return typeof run.state === "string" && ACTIVE_RUN_STATES.has(run.state);
}

function assertApprovalShape(approval: JsonRecord): void {
  expect(idOf(approval)).toMatch(UUID_PATTERN);
  expect(typeof approval.requesterId).toBe("string");
  expect(approval.requesterId as string).toMatch(UUID_PATTERN);
  asRecord(approval.requiredApproverPolicy, "approval.requiredApproverPolicy");
  expect(typeof approval.policyRevision).toBe("number");
  expect(APPROVAL_STATES).toContain(approval.state);
  expect(typeof approval.expiresAt).toBe("string");
  expect(Number.isNaN(Date.parse(approval.expiresAt as string))).toBe(false);

  const proposal = asRecord(approval.actionProposal, "approval.actionProposal");
  expect(typeof proposal.toolName).toBe("string");
  asRecord(proposal.displayArgs, "approval.actionProposal.displayArgs");
  expect(Array.isArray(proposal.secretRefs)).toBe(true);
  for (const reference of proposal.secretRefs as unknown[]) {
    expect(typeof reference).toBe("string");
  }
  expect(typeof proposal.actionDigest).toBe("string");
  expect(proposal.actionDigest as string).toMatch(DIGEST_PATTERN);
  for (const field of ["purpose", "impact", "risk"] as const) {
    expect(typeof proposal[field]).toBe("string");
  }

  for (const forbidden of ["secret", "secretValue", "password", "credential", "token"]) {
    expect(approval).not.toHaveProperty(forbidden);
  }
}

describe("US1 personal Run API contract (live QS-01)", () => {
  it("creates a personal task without a team and returns a personal workspace", async () => {
    const fixture = await liveFixture();
    const name = uniqueName("US1 personal");
    const body = command({
      name,
      goal: "Complete the QS-01 personal task without a team",
      completionCriteria: "A Markdown report and code diff are saved as artifacts",
      runnerId: fixture.runnerId,
      agentProfileId: fixture.agentProfileId,
    });

    const created = expectStatus(
      await jsonApi("POST", "/personal-tasks", { body }),
      201,
      "creating a team-less personal task",
    );
    const workspace = entityOf(created.body, "workspace");
    const workspaceId = idOf(workspace);

    expect(workspaceId).toMatch(UUID_PATTERN);
    expect(workspace.kind).toBe("personal");
    expect(workspace.teamId === undefined || workspace.teamId === null).toBe(true);
    expect(workspace.ownerId).toBe(fixture.ownerId);
    expect(workspace.runnerId).toBe(fixture.runnerId);
    expect(workspace.name).toBe(name);
    expect(["draft", "active"]).toContain(workspace.status);
    expect(typeof workspace.revision).toBe("number");
    expect(operatorEpochOf(workspace)).toBeGreaterThanOrEqual(1);

    const currentOperator = asRecord(workspace.currentOperator, "workspace.currentOperator");
    expect(currentOperator.operatorId).toBe(fixture.ownerId);

    const fetched = expectStatus(
      await jsonApi("GET", `/personal-tasks/${workspaceId}`),
      200,
      "reading the personal task",
    );
    const fetchedWorkspace = entityOf(fetched.body, "workspace");
    expect(idOf(fetchedWorkspace)).toBe(workspaceId);
    expect(fetchedWorkspace.kind).toBe("personal");

    const listed = expectStatus(
      await jsonApi("GET", "/personal-tasks"),
      200,
      "listing personal tasks",
    );
    const listedTasks = arrayFrom(listed.body, "personalTasks", "workspaces").map((entry) =>
      asRecord(entry, "personal task"),
    );
    const listedIds = listedTasks
      .map((entry) => optionalString(entry, "id"))
      .filter((value): value is string => typeof value === "string");
    expect(listedIds).toContain(workspaceId);
  }, 30_000);

  it("replays an identical personal-task command and rejects a reused key with a different payload", async () => {
    const fixture = await liveFixture();
    const name = uniqueName("US1 idempotent");
    const payload = {
      name,
      goal: "Prove idempotent personal-task creation",
      completionCriteria: "The first committed workspace is replayed",
      runnerId: fixture.runnerId,
      agentProfileId: fixture.agentProfileId,
    };
    const body = command(payload);
    const idempotencyKey = newIdempotencyKey();

    const first = expectStatus(
      await jsonApi("POST", "/personal-tasks", { body, idempotencyKey }),
      201,
      "first personal-task command",
    );
    const firstWorkspace = entityOf(first.body, "workspace");
    const firstWorkspaceId = idOf(firstWorkspace);

    const replay = expectStatus(
      await jsonApi("POST", "/personal-tasks", { body, idempotencyKey }),
      [200, 201],
      "replaying the same personal-task command",
    );
    expect(idOf(entityOf(replay.body, "workspace"))).toBe(firstWorkspaceId);

    const changedName = uniqueName("US1 changed payload");
    const conflict = await jsonApi("POST", "/personal-tasks", {
      body: command({ ...payload, name: changedName }),
      idempotencyKey,
    });
    expectProblem(
      conflict,
      409,
      "revision_conflict",
      "reusing an idempotency key with a different payload",
    );

    const listed = expectStatus(
      await jsonApi("GET", "/personal-tasks"),
      200,
      "listing personal tasks after an idempotency conflict",
    );
    const listedTasks = arrayFrom(listed.body, "personalTasks", "workspaces").map((entry) =>
      asRecord(entry, "personal task"),
    );
    expect(listedTasks.some((entry) => optionalString(entry, "name") === changedName)).toBe(false);

    const missingKey = await jsonApi("POST", "/personal-tasks", {
      body: command({ ...payload, name: uniqueName("US1 missing key") }),
      idempotencyKey: null,
    });
    expectProblem(
      missingKey,
      400,
      "invalid_request",
      "creating a personal task without an Idempotency-Key",
    );
  }, 30_000);

  it("accepts startRun with 202 and replays the same key without creating a second Run", async () => {
    const task = await createPersonalTask("US1 start");
    const operatorEpoch = operatorEpochOf(task.workspace);
    const runBody = command({
      operatorEpoch,
      body: "Create a Markdown report and a code diff for the QS-01 personal task.",
    });
    const idempotencyKey = newIdempotencyKey();

    const accepted = expectStatus(
      await jsonApi("POST", `/workspaces/${task.workspaceId}/runs`, {
        body: runBody,
        idempotencyKey,
      }),
      202,
      "starting a personal Run",
    );
    const run = entityOf(accepted.body, "run");
    const runId = idOf(run);

    expect(runId).toMatch(UUID_PATTERN);
    expect(run.workspaceId).toBe(task.workspaceId);
    expect(run.operatorEpoch).toBe(operatorEpoch);
    expect(RUN_STATES).toContain(run.state);
    expect(run.contextSnapshotId).toMatch(UUID_PATTERN);

    const replay = expectStatus(
      await jsonApi("POST", `/workspaces/${task.workspaceId}/runs`, {
        body: runBody,
        idempotencyKey,
      }),
      202,
      "replaying the same startRun command",
    );
    expect(idOf(entityOf(replay.body, "run"))).toBe(runId);

    const fetched = expectStatus(
      await jsonApi("GET", `/workspaces/${task.workspaceId}/runs/${runId}`),
      200,
      "reading the accepted Run",
    );
    expect(idOf(entityOf(fetched.body, "run"))).toBe(runId);

    const runs = await listRuns(task.workspaceId);
    expect(runs.filter((entry) => idOf(entry) === runId)).toHaveLength(1);
  }, 30_000);

  it("admits only one active Run when two different start keys race", async () => {
    const task = await createPersonalTask("US1 concurrent");
    const operatorEpoch = operatorEpochOf(task.workspace);

    const start = (label: string) =>
      jsonApi("POST", `/workspaces/${task.workspaceId}/runs`, {
        body: command({
          operatorEpoch,
          body: `Concurrent QS-01 start ${label}; hold the Run open for operator review.`,
        }),
        idempotencyKey: newIdempotencyKey(),
      });

    const responses = await Promise.all([start("A"), start("B")]);
    const accepted = responses.filter((response) => response.status === 202);
    const rejected = responses.filter((response) => response.status !== 202);

    if (accepted.length !== 1) {
      throw new Error(
        `[US1 contract mismatch] Two concurrent startRun commands must admit exactly one Run; ` +
          `received statuses ${responses.map((response) => response.status).join(", ")}.`,
      );
    }
    if (rejected.length !== 1) {
      throw new Error(
        `[US1 contract mismatch] Two concurrent startRun commands must reject exactly one; ` +
          `received statuses ${responses.map((response) => response.status).join(", ")}.`,
      );
    }

    const winner = accepted[0];
    const loser = rejected[0];
    if (!winner || !loser) {
      throw new Error("[US1 contract mismatch] Concurrent start result was not observable");
    }

    expectProblem(loser, 409, "task_active", "starting a second Run while one is active");

    const winnerRun = entityOf(winner.body, "run");
    const winnerId = idOf(winnerRun);
    const runs = await listRuns(task.workspaceId);
    const activeRuns = runs.filter(isActiveRun);

    expect(activeRuns.length).toBeLessThanOrEqual(1);
    if (activeRuns[0]) {
      expect(idOf(activeRuns[0])).toBe(winnerId);
    }
    expect(runs.filter((entry) => idOf(entry) === winnerId)).toHaveLength(1);
  }, 30_000);

  it("rejects a stale operatorEpoch with operator_changed", async () => {
    const task = await createPersonalTask("US1 stale epoch");
    const epoch = operatorEpochOf(task.workspace);
    let staleEpoch: number;

    if (epoch > 1) {
      staleEpoch = epoch - 1;
    } else {
      const current = expectStatus(
        await jsonApi("GET", `/workspaces/${task.workspaceId}`),
        200,
        "reading the workspace before rotating the operator epoch",
      );
      const currentWorkspace = entityOf(current.body, "workspace");
      const revision = revisionOf(currentWorkspace);

      const takeover = await jsonApi("POST", `/workspaces/${task.workspaceId}/operator-takeover`, {
        headers: { "If-Match": `"${revision}"` },
        body: command({
          kind: "forced",
          operatorEpoch: epoch,
          reason: "US1 stale-epoch contract fixture",
        }),
        idempotencyKey: newIdempotencyKey(),
      });
      if (takeover.status !== 200) {
        throw new Error(
          "[US1 missing behavior] The contract's operator-takeover endpoint could not rotate " +
            `the personal workspace epoch: received ${takeover.status}: ${truncate(takeover.text)}`,
        );
      }

      const updated = expectStatus(
        await jsonApi("GET", `/workspaces/${task.workspaceId}`),
        200,
        "reading the workspace after rotating the operator epoch",
      );
      const updatedEpoch = operatorEpochOf(entityOf(updated.body, "workspace"));
      expect(updatedEpoch).toBe(epoch + 1);
      staleEpoch = epoch;
    }

    const stale = await jsonApi("POST", `/workspaces/${task.workspaceId}/runs`, {
      body: command({
        operatorEpoch: staleEpoch,
        body: "A stale operator must not start a Run.",
      }),
      idempotencyKey: newIdempotencyKey(),
    });
    expectProblem(stale, 409, "operator_changed", "starting a Run with a stale operatorEpoch");

    const runs = await listRuns(task.workspaceId);
    expect(runs).toHaveLength(0);
  }, 30_000);

  it("returns approval list/detail structures and validates decision requests without leaking secrets", async () => {
    const listed = expectStatus(
      await jsonApi("GET", "/approvals"),
      200,
      "listing visible approvals",
    );
    const listBody = asRecord(listed.body, "approval list");
    expect(Array.isArray(listBody.items)).toBe(true);
    for (const key of Object.keys(listBody)) {
      expect(["items", "nextCursor"]).toContain(key);
    }
    if (listBody.nextCursor !== undefined) {
      expect(typeof listBody.nextCursor).toBe("string");
    }

    const items = listBody.items as unknown[];
    for (const item of items) {
      expect(idOf(asRecord(item, "approval"))).toMatch(UUID_PATTERN);
    }

    const configuredApprovalId = firstEnv("UNSPOOL_US1_APPROVAL_ID", "US1_APPROVAL_ID");
    const firstItem = items[0];
    const detailId =
      configuredApprovalId ?? (firstItem ? idOf(asRecord(firstItem, "approval")) : undefined);

    if (detailId) {
      const detail = expectStatus(
        await jsonApi("GET", `/approvals/${detailId}`),
        200,
        "reading an approval detail",
      );
      const approval = asRecord(detail.body, "approval");
      expect(idOf(approval)).toBe(detailId);
      assertApprovalShape(approval);
    }

    const unknownApprovalId = uuidv7();
    const unknown = await jsonApi("GET", `/approvals/${unknownApprovalId}`);
    expectProblem(unknown, 404, "not_found", "reading an invisible approval");

    const invalidDecision = await jsonApi("POST", `/approvals/${unknownApprovalId}/decision`, {
      body: command({
        decision: "maybe",
        actionDigest: `sha256:${"0".repeat(64)}`,
        reason: "Invalid decision enum",
      }),
      idempotencyKey: newIdempotencyKey(),
    });
    expectProblem(
      invalidDecision,
      400,
      "invalid_request",
      "rejecting an invalid approval decision",
    );

    const missingDecision = await jsonApi("POST", `/approvals/${unknownApprovalId}/decision`, {
      body: command({
        decision: "rejected",
        actionDigest: `sha256:${"0".repeat(64)}`,
        reason: "Approval is not visible",
      }),
      idempotencyKey: newIdempotencyKey(),
    });
    expectProblem(missingDecision, 404, "not_found", "deciding an invisible approval");
  }, 30_000);

  it("round-trips artifact content with SHA-256 and supports Range downloads", async () => {
    const task = await createPersonalTask("US1 artifact");
    const content = `# QS-01 report\n\nArtifact canary: ${uuidv7()}\n`;
    const contentBytes = Buffer.from(content, "utf8");
    const expectedDigest = `sha256:${sha256Hex(contentBytes)}`;
    const metadata = {
      name: "qs-01-report.md",
      mediaType: "text/markdown",
      size: contentBytes.length,
      sha256: expectedDigest,
      kind: "reference",
      sourceSummary: "QS-01 personal task artifact",
    };

    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("content", new Blob([content], { type: "text/markdown" }), metadata.name);

    const upload = expectStatus(
      await jsonApi("POST", `/workspaces/${task.workspaceId}/artifacts`, { body: form }),
      201,
      "uploading a reference artifact",
    );
    const artifact = entityOf(upload.body, "artifact");
    const artifactId =
      optionalString(artifact, "id") ?? optionalString(artifact, "artifactId") ?? idOf(artifact);
    expect(artifactId).toMatch(UUID_PATTERN);

    const artifactPath = `/workspaces/${task.workspaceId}/artifacts/${artifactId}/content`;
    const download = expectStatus(
      await rawApi("GET", artifactPath),
      200,
      "downloading the artifact",
    );
    expect(download.headers.get("content-type") ?? "").toContain("application/octet-stream");
    expect(download.bytes.length).toBe(contentBytes.length);
    expect(`sha256:${sha256Hex(download.bytes)}`).toBe(expectedDigest);

    const range = expectStatus(
      await rawApi("GET", artifactPath, { headers: { Range: "bytes=0-7" } }),
      206,
      "downloading an artifact byte range",
    );
    expect(range.headers.get("content-range") ?? "").toMatch(/^bytes 0-7\/\d+$/);
    expect(range.bytes.length).toBe(8);
    expect(`sha256:${sha256Hex(range.bytes)}`).toBe(
      `sha256:${sha256Hex(contentBytes.subarray(0, 8))}`,
    );

    const tamperedMetadata = {
      ...metadata,
      name: "qs-01-tampered.md",
      sha256: `sha256:${"0".repeat(64)}`,
    };
    const tamperedForm = new FormData();
    tamperedForm.set(
      "metadata",
      new Blob([JSON.stringify(tamperedMetadata)], { type: "application/json" }),
    );
    tamperedForm.append(
      "content",
      new Blob([content], { type: "text/markdown" }),
      tamperedMetadata.name,
    );
    const rejected = await jsonApi("POST", `/workspaces/${task.workspaceId}/artifacts`, {
      body: tamperedForm,
    });
    expectProblem(
      rejected,
      400,
      "invalid_request",
      "rejecting an artifact whose metadata SHA-256 does not match its bytes",
    );
  }, 30_000);

  it("returns redacted RFC 9457 problems for unknown and invalid requests", async () => {
    const missing = await jsonApi("GET", `/workspaces/${uuidv7()}`);
    expectProblem(missing, 404, "not_found", "reading an unknown workspace");

    const canary = `US1_SECRET_CANARY_${uuidv7()}`;
    const invalid = await jsonApi("POST", "/personal-tasks", {
      body: command({
        name: "",
        goal: canary,
        completionCriteria: "Must not echo secrets",
        runnerId: canary,
        agentProfileId: canary,
      }),
      idempotencyKey: newIdempotencyKey(),
    });
    expectProblem(invalid, 400, "invalid_request", "rejecting an invalid personal-task body");
    expect(invalid.text).not.toContain(canary);

    const unauthorized = await jsonApi("GET", "/personal-tasks", { token: null });
    expectProblem(unauthorized, 401, "unauthenticated", "reading personal tasks without a session");
    expect(unauthorized.text).not.toMatch(/Bearer|UNSPOOL_US1_OWNER_TOKEN/);
  }, 30_000);
});
