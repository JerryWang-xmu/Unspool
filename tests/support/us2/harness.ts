import { createHash, randomBytes } from "node:crypto";

/**
 * Shared black-box harness for the US2 prerequisite tests.
 *
 * These tests use the external contract in
 * `specs/001-agent-federated-collaboration/contracts/runner-api.openapi.yaml`.
 * They intentionally fail with an explicit message while the Runner API,
 * fixtures or planned test dependencies do not exist yet.
 */

export type JsonRecord = Record<string, unknown>;

export type Us2Role = "owner" | "operator" | "contributor" | "observer" | "expert" | "admin";

export interface Principal {
  id: string;
  displayName?: string;
}

export interface ApiResult {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
  request: {
    method: string;
    url: string;
    idempotencyKey?: string;
  };
}

export interface ApiOptions {
  body?: JsonRecord | FormData;
  headers?: Record<string, string>;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
}

export interface TeamFixture {
  teamId: string;
  runnerId: string;
  agentProfileId: string;
  owner: Principal;
  operator: Principal;
  contributor: Principal;
  observer: Principal;
  expert?: Principal;
  admin?: Principal;
  teamMemberships: Partial<Record<Us2Role, JsonRecord>>;
}

export interface SharedWorkspaceFixture extends TeamFixture {
  workspaceId: string;
  workspace: JsonRecord;
  workspaceMemberships: Partial<Record<Exclude<Us2Role, "admin">, JsonRecord>>;
}

export interface NorthStarWorkspaceActivity {
  workspaceId: string;
  completedAgentRunCount: number;
  memberIds: string[];
  effectiveActions: Array<{ actorId: string; kind: string }>;
  viewCount: number;
}

export interface NorthStarInput {
  week: string;
  workspaces: NorthStarWorkspaceActivity[];
}

export interface NorthStarResult {
  count: number;
  workspaceIds: string[];
}

const TOKEN_ENV: Record<Us2Role, string> = {
  owner: "UNSPOOL_US2_OWNER_TOKEN",
  operator: "UNSPOOL_US2_OPERATOR_TOKEN",
  contributor: "UNSPOOL_US2_CONTRIBUTOR_TOKEN",
  observer: "UNSPOOL_US2_OBSERVER_TOKEN",
  expert: "UNSPOOL_US2_EXPERT_TOKEN",
  admin: "UNSPOOL_US2_ADMIN_TOKEN",
};

export function runnerApiBaseUrl(): string {
  const value = process.env.UNSPOOL_RUNNER_API_URL?.trim();
  if (!value) {
    throw new Error(
      "[US2 setup missing] UNSPOOL_RUNNER_API_URL is not set. " +
        "Start the Stable Runner from quickstart QS-02 and set, for example, " +
        "UNSPOOL_RUNNER_API_URL=https://localhost:8443/v1.",
    );
  }
  return value.replace(/\/+$/, "");
}

function tokenFor(role: Us2Role): string {
  const value = process.env[TOKEN_ENV[role]]?.trim();
  if (value) {
    return value;
  }
  if (role === "operator") {
    return tokenFor("owner");
  }
  throw new Error(
    `[US2 setup missing] ${TOKEN_ENV[role]} is not set. ` +
      "Prepare independent GUI/session fixtures for the US2 roles before running this test.",
  );
}

export function hasToken(role: Us2Role): boolean {
  if (process.env[TOKEN_ENV[role]]?.trim()) {
    return true;
  }
  return role === "operator" && Boolean(process.env.UNSPOOL_US2_OWNER_TOKEN?.trim());
}

export function newIdempotencyKey(): string {
  return uuidv7();
}

export function uuidv7(): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`JCS cannot encode non-finite number: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry === undefined ? null : entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    const fields = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${fields.join(",")}}`;
  }
  throw new Error(`JCS cannot encode ${typeof value}`);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/**
 * The contract requires `payloadDigest` to be SHA-256 over JCS canonical JSON.
 * This harness treats the business payload (the fields supplied by the caller)
 * as the payload and excludes the command envelope fields from the digest.
 */
export function command(payload: JsonRecord): JsonRecord {
  return {
    commandId: uuidv7(),
    schemaVersion: 1,
    ...payload,
    payloadDigest: sha256Digest(payload),
  };
}

export async function callApi(
  role: Us2Role,
  method: string,
  path: string,
  options: ApiOptions = {},
): Promise<ApiResult> {
  const baseUrl = runnerApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${tokenFor(role)}`,
    ...options.headers,
  };

  let body: string | FormData | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const idempotencyKey =
    options.idempotencyKey === null
      ? undefined
      : (options.idempotencyKey ?? (method === "GET" || method === "HEAD" ? undefined : uuidv7()));
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `[US2 missing behavior] Runner API is unreachable at ${url}. ` +
        "Start the Stable Runner and model/worker fixtures for QS-02. " +
        `Original error: ${describeError(error)}`,
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    body: parsed,
    text,
    request: { method, url, idempotencyKey },
  };
}

export function ensureStatus(
  result: ApiResult,
  expected: number | number[],
  action: string,
): ApiResult {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(
      `[US2 missing behavior] ${action} expected HTTP ${expectedStatuses.join("/")} ` +
        `but received ${result.status}: ${result.text}`,
    );
  }
  return result;
}

export function asRecord(value: unknown, label = "object"): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(
      `[US2 contract mismatch] Expected ${label} to be a JSON object, got: ${stringify(value)}`,
    );
  }
  return value;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function entity(body: unknown, key: string): JsonRecord {
  const record = asRecord(body, key);
  const direct = record[key];
  if (isRecord(direct)) {
    return direct;
  }
  for (const wrapper of ["data", "result", "resource", "value"]) {
    const nested = record[wrapper];
    if (isRecord(nested)) {
      if (isRecord(nested[key])) {
        return nested[key] as JsonRecord;
      }
      return nested;
    }
  }
  return record;
}

export function collection(body: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  const record = asRecord(body, "collection");
  for (const key of [...keys, "items", "members", "runs", "results", "records", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (isRecord(value)) {
      for (const nestedKey of ["items", "members", "runs", "results", "records"]) {
        const nested = value[nestedKey];
        if (Array.isArray(nested)) {
          return nested;
        }
      }
    }
  }
  throw new Error(
    `[US2 contract mismatch] Response does not contain a collection: ${stringify(body)}`,
  );
}

export function idOf(body: unknown, key = "id"): string {
  const record = asRecord(body, key);
  const direct = record[key];
  if (typeof direct === "string") {
    return direct;
  }
  for (const nestedKey of [
    "team",
    "workspace",
    "runner",
    "membership",
    "contextItem",
    "artifact",
    "conclusion",
    "run",
    "data",
    "resource",
  ]) {
    const nested = record[nestedKey];
    if (isRecord(nested) && typeof nested[key] === "string") {
      return nested[key] as string;
    }
  }
  throw new Error(`[US2 contract mismatch] Response does not contain ${key}: ${stringify(body)}`);
}

export function optionalString(body: unknown, key: string): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function revisionOf(body: unknown, label = "entity"): number {
  const record = entity(body, label);
  const revision = record.revision;
  if (typeof revision === "number") {
    return revision;
  }
  const currentVersion = record.currentVersion;
  if (isRecord(currentVersion) && typeof currentVersion.revision === "number") {
    return currentVersion.revision;
  }
  throw new Error(
    `[US2 contract mismatch] ${label} does not expose a numeric revision: ${stringify(body)}`,
  );
}

export function ifMatch(revision: number): string {
  return `"${revision}"`;
}

export function currentVersionId(contextItem: unknown): string {
  const record = entity(contextItem, "contextItem");
  if (typeof record.currentVersionId === "string") {
    return record.currentVersionId;
  }
  if (isRecord(record.currentVersion) && typeof record.currentVersion.id === "string") {
    return record.currentVersion.id;
  }
  const versions = record.versions;
  if (Array.isArray(versions) && isRecord(versions[0]) && typeof versions[0].id === "string") {
    return versions[0].id;
  }
  throw new Error(
    `[US2 contract mismatch] Context item does not expose currentVersionId/currentVersion.id: ${stringify(contextItem)}`,
  );
}

export function versionRecords(contextItem: unknown): JsonRecord[] {
  const record = entity(contextItem, "contextItem");
  if (Array.isArray(record.versions)) {
    return record.versions.map((entry) => asRecord(entry, "context version"));
  }
  if (isRecord(record.currentVersion)) {
    return [record.currentVersion];
  }
  return [];
}

export function problemCode(body: unknown): string | undefined {
  const record = asRecord(body, "problem");
  return typeof record.code === "string" ? record.code : undefined;
}

export function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function getPrincipal(role: Us2Role): Promise<Principal> {
  const principal = await tryGetPrincipal(role);
  if (!principal) {
    throw new Error(`[US2 setup missing] ${TOKEN_ENV[role]} is required for this scenario.`);
  }
  return principal;
}

export async function tryGetPrincipal(role: Us2Role): Promise<Principal | undefined> {
  if (!hasToken(role)) {
    return undefined;
  }
  const response = ensureStatus(
    await callApi(role, "GET", "/me"),
    200,
    `discovering the ${role} principal`,
  );
  const record = entity(response.body, "principal");
  const id =
    optionalString(record, "id") ??
    optionalString(record, "userId") ??
    optionalString(record, "principalId") ??
    optionalString(record, "actorId");
  if (!id) {
    throw new Error(`[US2 contract mismatch] /me did not return a principal id: ${response.text}`);
  }
  return {
    id,
    displayName:
      optionalString(record, "displayName") ??
      optionalString(record, "name") ??
      optionalString(record, "displayNameAtTime"),
  };
}

export async function provisionTeam(): Promise<TeamFixture> {
  const owner = await getPrincipal("owner");
  const operator = (await tryGetPrincipal("operator")) ?? owner;
  const contributor = await getPrincipal("contributor");
  const observer = await getPrincipal("observer");
  const expert = await tryGetPrincipal("expert");
  const admin = await tryGetPrincipal("admin");

  const suffix = randomBytes(3).toString("hex");
  const teamResponse = ensureStatus(
    await callApi("owner", "POST", "/teams", {
      body: command({ name: `US2 contract ${suffix}` }),
    }),
    201,
    "creating a US2 team",
  );
  const teamId = idOf(teamResponse.body);

  const allowedSubjects = [owner.id, operator.id, contributor.id, observer.id]
    .concat(expert ? [expert.id] : [])
    .filter((value, index, all) => all.indexOf(value) === index);
  const runnerResponse = ensureStatus(
    await callApi("owner", "POST", `/teams/${teamId}/runners`, {
      body: command({
        name: `US2 runner ${suffix}`,
        purpose: "US2 collaboration acceptance tests",
        version: "test",
        capabilities: [],
        allowedSubjects,
      }),
    }),
    201,
    "registering a US2 test runner",
  );
  const runnerId = idOf(runnerResponse.body);

  const profileResponse = ensureStatus(
    await callApi("owner", "POST", `/runners/${runnerId}/model-profiles`, {
      body: command({
        provider: "faux",
        model: "faux-us2",
        reasoningOptions: {},
        enabled: true,
      }),
    }),
    201,
    "creating a faux model profile",
  );
  const agentProfileId =
    optionalString(profileResponse.body, "profileId") ??
    optionalString(profileResponse.body, "id") ??
    (() => {
      const record = asRecord(profileResponse.body, "model profile");
      if (isRecord(record.profile) && typeof record.profile.id === "string") {
        return record.profile.id;
      }
      throw new Error(
        `[US2 contract mismatch] Model profile response does not expose an id: ${profileResponse.text}`,
      );
    })();

  const teamMemberships: Partial<Record<Us2Role, JsonRecord>> = {};
  const inviteTeamMember = async (
    role: Us2Role,
    principal: Principal | undefined,
    teamRoles: string[],
  ) => {
    if (!principal || principal.id === owner.id) {
      return;
    }
    const response = ensureStatus(
      await callApi("owner", "POST", `/teams/${teamId}/members`, {
        body: command({ userId: principal.id, teamRoles }),
      }),
      201,
      `inviting ${role} to the team`,
    );
    teamMemberships[role] = entity(response.body, "membership");
  };

  await inviteTeamMember("operator", operator, ["member"]);
  await inviteTeamMember("contributor", contributor, ["member"]);
  await inviteTeamMember("observer", observer, ["member"]);
  await inviteTeamMember("expert", expert, ["member"]);
  await inviteTeamMember("admin", admin, ["administrator"]);

  return {
    teamId,
    runnerId,
    agentProfileId,
    owner,
    operator,
    contributor,
    observer,
    expert,
    admin,
    teamMemberships,
  };
}

export async function createSharedWorkspaceOnTeam(
  fixture: TeamFixture,
  options: { name: string; goal: string; completionCriteria: string },
): Promise<{
  workspace: JsonRecord;
  workspaceId: string;
  workspaceMemberships: SharedWorkspaceFixture["workspaceMemberships"];
}> {
  const response = ensureStatus(
    await callApi("owner", "POST", "/workspaces", {
      body: command({
        name: options.name,
        goal: options.goal,
        completionCriteria: options.completionCriteria,
        teamId: fixture.teamId,
        runnerId: fixture.runnerId,
        agentProfileId: fixture.agentProfileId,
      }),
    }),
    201,
    "creating a shared workspace",
  );
  const workspace = entity(response.body, "workspace");
  const workspaceId = idOf(workspace);

  const workspaceMemberships: SharedWorkspaceFixture["workspaceMemberships"] = {};
  const inviteWorkspaceMember = async (
    role: Exclude<Us2Role, "admin">,
    principal: Principal | undefined,
    workspaceRole: string,
    permissions: { canApprove?: boolean; canReview?: boolean } = {},
  ) => {
    if (!principal || principal.id === fixture.owner.id) {
      return;
    }
    const inviteResponse = ensureStatus(
      await callApi("owner", "POST", `/workspaces/${workspaceId}/members`, {
        body: command({
          members: [
            {
              userId: principal.id,
              role: workspaceRole,
              canApprove: permissions.canApprove ?? false,
              canReview: permissions.canReview ?? false,
            },
          ],
        }),
      }),
      201,
      `inviting ${role} to the workspace`,
    );
    workspaceMemberships[role] = entity(inviteResponse.body, "membership");
  };

  await inviteWorkspaceMember("operator", fixture.operator, "operator", {
    canApprove: true,
    canReview: true,
  });
  await inviteWorkspaceMember("contributor", fixture.contributor, "contributor", {
    canReview: true,
  });
  await inviteWorkspaceMember("observer", fixture.observer, "observer");
  await inviteWorkspaceMember("expert", fixture.expert, "contributor", {
    canReview: false,
  });

  return { workspace, workspaceId, workspaceMemberships };
}

export async function provisionSharedWorkspace(options: {
  name: string;
  goal: string;
  completionCriteria: string;
}): Promise<SharedWorkspaceFixture> {
  const team = await provisionTeam();
  const shared = await createSharedWorkspaceOnTeam(team, options);
  return {
    ...team,
    workspaceId: shared.workspaceId,
    workspace: shared.workspace,
    workspaceMemberships: shared.workspaceMemberships,
  };
}

export async function createPersonalTask(
  runnerId: string,
  agentProfileId: string,
  options: { name: string; goal: string; completionCriteria: string },
): Promise<{ workspace: JsonRecord; workspaceId: string }> {
  const response = ensureStatus(
    await callApi("owner", "POST", "/personal-tasks", {
      body: command({
        name: options.name,
        goal: options.goal,
        completionCriteria: options.completionCriteria,
        runnerId,
        agentProfileId,
      }),
    }),
    201,
    "creating a personal task",
  );
  const workspace = entity(response.body, "workspace");
  return { workspace, workspaceId: idOf(workspace) };
}

export interface ContextInput {
  kind: string;
  title: string;
  body: string;
  memberVisibility: string;
  agentExposure: string;
  sourceRefs?: string[];
}

export async function createContextItem(
  role: Us2Role,
  workspaceId: string,
  input: ContextInput,
): Promise<{ item: JsonRecord; versionId: string; revision: number }> {
  const response = ensureStatus(
    await callApi(role, "POST", `/workspaces/${workspaceId}/context-items`, {
      body: command({ ...input, sourceRefs: input.sourceRefs ?? [] }),
    }),
    201,
    "creating a context item",
  );
  const item = entity(response.body, "contextItem");
  return {
    item,
    versionId: currentVersionId(item),
    revision: revisionOf(item, "contextItem"),
  };
}

export async function appendContextVersion(
  role: Us2Role,
  workspaceId: string,
  contextItemId: string,
  expectedRevision: number,
  input: ContextInput,
  idempotencyKey?: string,
): Promise<ApiResult> {
  return callApi(
    role,
    "POST",
    `/workspaces/${workspaceId}/context-items/${contextItemId}/versions`,
    {
      headers: { "If-Match": ifMatch(expectedRevision) },
      idempotencyKey,
      body: command({ ...input, sourceRefs: input.sourceRefs ?? [] }),
    },
  );
}

export async function uploadArtifact(
  role: Us2Role,
  workspaceId: string,
  options: {
    name: string;
    content: string;
    mediaType?: string;
    sourceSummary: string;
    runId?: string;
  },
): Promise<{ artifact: JsonRecord; artifactId: string }> {
  const metadata = {
    name: options.name,
    mediaType: options.mediaType ?? "text/plain",
    size: Buffer.byteLength(options.content, "utf8"),
    sha256: `sha256:${sha256Hex(options.content)}`,
    kind: "reference",
    sourceSummary: options.sourceSummary,
    ...(options.runId ? { runId: options.runId } : {}),
  };
  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("content", new Blob([options.content], { type: metadata.mediaType }), options.name);
  const response = ensureStatus(
    await callApi(role, "POST", `/workspaces/${workspaceId}/artifacts`, { body: form }),
    201,
    "uploading a reference artifact",
  );
  const artifact = entity(response.body, "artifact");
  return { artifact, artifactId: idOf(artifact) };
}

export async function startRun(
  role: Us2Role,
  workspaceId: string,
  operatorEpoch: number,
  body: string,
  idempotencyKey?: string,
): Promise<ApiResult> {
  return callApi(role, "POST", `/workspaces/${workspaceId}/runs`, {
    idempotencyKey,
    body: command({ operatorEpoch, body }),
  });
}

export async function listRuns(role: Us2Role, workspaceId: string): Promise<unknown[]> {
  const response = ensureStatus(
    await callApi(role, "GET", `/workspaces/${workspaceId}/runs`),
    200,
    "listing workspace runs",
  );
  return collection(response.body, "runs");
}

export function activeRunId(runs: unknown[]): string | undefined {
  const activeStates = new Set([
    "created",
    "running",
    "waiting_approval",
    "stopping",
    "needs_confirmation",
  ]);
  for (const run of runs) {
    const record = asRecord(run, "run");
    if (typeof record.state === "string" && activeStates.has(record.state)) {
      return idOf(record);
    }
  }
  return undefined;
}

/**
 * Reads the permission-filtered workspace SSE stream for a bounded window.
 * The test environment does not need a persistent connection after the test.
 */
export async function readWorkspaceEvents(
  role: Us2Role,
  workspaceId: string,
  options: { after?: number; timeoutMs?: number } = {},
): Promise<unknown[]> {
  const baseUrl = runnerApiBaseUrl();
  const after = options.after ?? 0;
  const url = `${baseUrl}/workspaces/${workspaceId}/events?after=${after}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  const events: unknown[] = [];

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${tokenFor(role)}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `[US2 missing behavior] Workspace event stream returned ${response.status}: ${await response.text()}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const parsed = await response.json();
      return Array.isArray(parsed) ? parsed : collection(parsed, "events");
    }
    if (!response.body) {
      return events;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.indexOf("\n\n");
        while (separator >= 0) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const dataLines = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length > 0) {
            try {
              events.push(JSON.parse(dataLines.join("\n")));
            } catch {
              // Ignore comments or non-JSON keep-alives; the contract only
              // requires JSON DomainEvent data lines.
            }
          }
          separator = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    if (!isAbortError(error)) {
      throw new Error(
        `[US2 missing behavior] Workspace event stream is unavailable at ${url}: ${describeError(error)}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }

  return events;
}

/**
 * FR-052/T106 has no OpenAPI read endpoint. The tests pin the smallest
 * observable seam: a pure week calculation over workspace activity summaries.
 * The implementation may expose this under either accepted export name.
 */
export async function calculateStableNorthStar(input: NorthStarInput): Promise<NorthStarResult> {
  let module: JsonRecord;
  try {
    module = (await import(
      "../../../apps/runner-api/src/telemetry/collaboration-metrics"
    )) as JsonRecord;
  } catch (error) {
    throw new Error(
      "[US2 missing behavior] apps/runner-api/src/telemetry/collaboration-metrics.ts " +
        "does not exist, so the Stable north-star metric cannot be verified. " +
        `Original error: ${describeError(error)}`,
    );
  }
  const calculate = module.calculateStableNorthStar ?? module.computeStableNorthStar;
  if (typeof calculate !== "function") {
    throw new Error(
      "[US2 missing behavior] collaboration-metrics.ts must export " +
        "calculateStableNorthStar(input) or computeStableNorthStar(input).",
    );
  }
  const result = asRecord(
    await (calculate as (value: NorthStarInput) => unknown)(input),
    "north-star result",
  );
  if (typeof result.count !== "number" || !Array.isArray(result.workspaceIds)) {
    throw new Error(
      `[US2 contract mismatch] North-star result must contain count and workspaceIds: ${stringify(result)}`,
    );
  }
  return {
    count: result.count,
    workspaceIds: result.workspaceIds.filter((value): value is string => typeof value === "string"),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
