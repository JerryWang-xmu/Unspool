import type {
  ActionProposalView,
  ApprovalState,
  ApprovalView,
  ArtifactAvailability,
  ArtifactView,
  BackupStatus,
  CreatePersonalTaskInput,
  ModelProfileSummary,
  PersonalTaskSummary,
  RunDetail,
  RunnerClient,
  RunnerHealth,
  RunnerSummary,
  RunState,
  RunSummary,
  StartRunInput,
  TimelineEvent,
  ToolCallView,
  ToolKind,
  UsageSummary,
  WorkspaceDetail,
} from "./types";

const DEFAULT_RUNNER_API_URL = "http://127.0.0.1:8080/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const EVENT_NAMES = [
  "workspace.created",
  "workspace.updated",
  "workspace.shared",
  "workspace.archived",
  "context.version_added",
  "context.agent_exposure_changed",
  "context.removed",
  "input.discussion_added",
  "input.suggestion_added",
  "input.suggestion_decided",
  "input.instruction_accepted",
  "run.accepted",
  "run.started",
  "run.steered",
  "run.follow_up_queued",
  "run.queue_held",
  "run.stopping",
  "run.settled",
  "run.result_assessed",
  "run.needs_confirmation",
  "tool.preflight",
  "tool.execution_entered",
  "tool.progress",
  "tool.finalized",
  "tool.receipt_gap",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.expired",
  "approval.invalidated",
  "approval.permit_consumed",
  "handoff.invited",
  "handoff.accepted",
  "handoff.rejected",
  "handoff.takeover",
  "handoff.background_changed",
  "evidence.proposed",
  "evidence.confirmed",
  "evidence.review_required",
  "evidence.invalidated",
  "evidence.reviewed",
  "evidence.exception_recorded",
  "artifact.added",
  "artifact.version_added",
  "artifact.missing",
  "artifact.export_started",
  "artifact.export_completed",
  "federation.node_state_changed",
  "federation.grant_decided",
  "federation.grant_revoked",
  "federation.operation_state_changed",
  "federation.artifact_propagated",
  "federation.patch_state_changed",
  "receipt.received",
  "receipt.gap_detected",
  "receipt.gap_resolved",
] as const;

export class RunnerApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number | null; code?: string | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "RunnerApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? false;
  }
}

interface RequestOptions {
  readonly method?: string;
  readonly json?: unknown;
  readonly form?: FormData;
  readonly idempotencyKey?: string;
  readonly accept?: string;
}

export interface RunnerClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): readonly string[] {
  return asArray(value)
    .map((entry) =>
      typeof entry === "string" ? entry : readString(isRecord(entry) ? entry.name : undefined),
    )
    .filter((entry): entry is string => entry !== undefined);
}

function unwrapRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  for (const key of keys) {
    const nested = value[key];
    if (isRecord(nested)) {
      return nested;
    }
  }
  return value;
}

function itemsFrom(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }

  for (const key of [
    "items",
    "data",
    "results",
    "personalTasks",
    "runners",
    "modelProfiles",
    "runs",
    "approvals",
    "artifacts",
  ]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const arrayValues = Object.values(value).filter(Array.isArray);
  return arrayValues.length === 1 ? (arrayValues[0] ?? null) : null;
}

function normalizeKind(value: unknown): "personal" | "shared" {
  return value === "shared" ? "shared" : "personal";
}

function normalizeWorkspaceStatus(value: unknown): PersonalTaskSummary["status"] {
  return value === "draft" || value === "active" || value === "archived" ? value : "unknown";
}

export function normalizeRunState(value: unknown): RunState {
  switch (value) {
    case "created":
    case "running":
    case "waiting_approval":
    case "stopping":
    case "technical_complete":
    case "failed":
    case "cancelled":
    case "needs_confirmation":
      return value;
    default:
      return "unknown";
  }
}

export function toolKindForName(toolName: string): ToolKind {
  const normalized = toolName.trim().toLowerCase();
  if (/^(read|list|glob|grep|search|open|stat|view|cat)/.test(normalized)) {
    return "read";
  }
  if (/^(write|edit|delete|remove|move|rename|append|patch|create)/.test(normalized)) {
    return "write";
  }
  if (/^(exec|execute|bash|shell|run|command|terminal)/.test(normalized)) {
    return "execute";
  }
  return "other";
}

function normalizeActor(value: unknown): TimelineEvent["actor"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const actorId = readString(value.actorId);
  const displayNameAtTime = readString(value.displayNameAtTime);
  const rolesAtTime = readStringArray(value.rolesAtTime);
  if (actorId === undefined && displayNameAtTime === undefined && rolesAtTime.length === 0) {
    return undefined;
  }
  return {
    ...(actorId === undefined ? {} : { actorId }),
    ...(displayNameAtTime === undefined ? {} : { displayNameAtTime }),
    ...(rolesAtTime.length === 0 ? {} : { rolesAtTime }),
  };
}

export function normalizeTimelineEvent(value: unknown, fallbackIndex = 0): TimelineEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  if (type === undefined) {
    return null;
  }
  const id =
    readString(value.eventId) ?? readString(value.id) ?? `${type}:${String(fallbackIndex)}`;
  const sequence = readNumber(value.sequence);
  const occurredAt = readString(value.occurredAt);
  const runId = readString(value.runId);
  const actor = normalizeActor(value.actor) ?? normalizeActor(value.attribution);
  const payload = isRecord(value.payload) ? value.payload : {};
  return {
    id,
    type,
    payload,
    ...(sequence === undefined ? {} : { sequence }),
    ...(occurredAt === undefined ? {} : { occurredAt }),
    ...(runId === undefined ? {} : { runId }),
    ...(actor === undefined ? {} : { actor }),
  };
}

function normalizeToolCall(value: unknown): ToolCallView | null {
  if (!isRecord(value)) {
    return null;
  }
  const toolName = readString(value.toolName) ?? readString(value.name) ?? "unknown-tool";
  const toolCallId = readString(value.toolCallId) ?? readString(value.id) ?? toolName;
  const state = readString(value.state) ?? "unknown";
  const approvalRequired = readBoolean(value.approvalRequired) ?? false;
  const output =
    readString(value.output) ?? readString(value.summary) ?? readString(value.delta) ?? undefined;
  const startedAt = readString(value.startedAt);
  const updatedAt =
    readString(value.updatedAt) ?? readString(value.finalizedAt) ?? readString(value.occurredAt);
  return {
    id: readString(value.id) ?? toolCallId,
    toolCallId,
    toolName,
    kind: toolKindForName(toolName),
    state: state.toLowerCase(),
    approvalRequired,
    ...(value.displayArgs === undefined ? {} : { displayArgs: value.displayArgs }),
    ...(output === undefined ? {} : { output }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function normalizeRun(value: unknown): RunSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id) ?? readString(value.runId);
  const workspaceId = readString(value.workspaceId);
  if (id === undefined || workspaceId === undefined) {
    return null;
  }
  const conversationId = readString(value.conversationId);
  const sessionId =
    readString(value.sessionId) ??
    readString(value.piSessionId) ??
    (isRecord(value.lastKnownCheckpoint)
      ? (readString(value.lastKnownCheckpoint.piSessionId) ??
        readString(value.lastKnownCheckpoint.sessionId))
      : undefined);
  const operatorEpoch = readNumber(value.operatorEpoch) ?? null;
  const contextSnapshotId = readString(value.contextSnapshotId);
  const startedAt = readString(value.startedAt);
  const endedAt = readString(value.endedAt);
  const result = readString(value.result);
  const unknownReason = readString(value.unknownReason);
  const lastKnownCheckpoint = isRecord(value.lastKnownCheckpoint)
    ? value.lastKnownCheckpoint
    : undefined;
  return {
    id,
    workspaceId,
    state: normalizeRunState(value.state),
    operatorEpoch,
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(contextSnapshotId === undefined ? {} : { contextSnapshotId }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(result === undefined ? {} : { result }),
    ...(unknownReason === undefined ? {} : { unknownReason }),
    ...(lastKnownCheckpoint === undefined ? {} : { lastKnownCheckpoint }),
  };
}

function normalizeRunDetail(value: unknown): RunDetail | null {
  const record = unwrapRecord(value, ["run"]);
  const run = normalizeRun(record);
  if (run === null) {
    return null;
  }
  const initialEvents = asArray(record.events)
    .map((event, index) => normalizeTimelineEvent(event, index))
    .filter((event): event is TimelineEvent => event !== null);
  const explicitPermits = asArray(record.permitEvents)
    .map((event, index) => normalizeTimelineEvent(event, index))
    .filter((event): event is TimelineEvent => event !== null);
  const derivedPermits = initialEvents.filter((event) => event.type === "approval.permit_consumed");
  const permitsById = new Map<string, TimelineEvent>();
  for (const event of [...explicitPermits, ...derivedPermits]) {
    permitsById.set(event.id, event);
  }
  const toolCalls = asArray(record.toolCalls)
    .map(normalizeToolCall)
    .filter((toolCall): toolCall is ToolCallView => toolCall !== null);

  return {
    ...run,
    toolCalls,
    initialEvents,
    permitEvents: [...permitsById.values()],
  };
}

function normalizeHealth(value: unknown): RunnerHealth {
  if (!isRecord(value)) {
    throw new RunnerApiError("Runner health response was not a JSON object.");
  }
  const status = value.status === "degraded" ? "degraded" : "ok";
  const runnerVersion = readString(value.runnerVersion) ?? readString(value.version);
  const schemaVersion = readNumber(value.schemaVersion);
  const supportState = readString(value.supportState);
  const maxUploadBytes = readNumber(value.maxUploadBytes);
  const maxActiveRunsPerWorkspace = readNumber(value.maxActiveRunsPerWorkspace);
  const maxWorkers = readNumber(value.maxWorkers);
  const dependencies = asArray(value.dependencies)
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const name = readString(entry.name);
      const dependencyStatus = entry.status;
      if (
        name === undefined ||
        (dependencyStatus !== "ok" &&
          dependencyStatus !== "degraded" &&
          dependencyStatus !== "unavailable")
      ) {
        return null;
      }
      return { name, status: dependencyStatus } as const;
    })
    .filter(
      (
        entry,
      ): entry is { readonly name: string; readonly status: "ok" | "degraded" | "unavailable" } =>
        entry !== null,
    );

  return {
    status,
    service: readString(value.service) ?? "runner-api",
    capabilities: readStringArray(value.capabilities),
    supportedPlatforms: readStringArray(value.supportedPlatforms),
    dependencies,
    ...(runnerVersion === undefined ? {} : { runnerVersion }),
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    ...(supportState === undefined ? {} : { supportState }),
    ...(maxUploadBytes === undefined ? {} : { maxUploadBytes }),
    ...(maxActiveRunsPerWorkspace === undefined ? {} : { maxActiveRunsPerWorkspace }),
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
  };
}

function normalizeRunner(value: unknown): RunnerSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id) ?? readString(value.runnerId);
  if (id === undefined) {
    return null;
  }
  const purpose = readString(value.purpose);
  const version = readString(value.version) ?? readString(value.runnerVersion);
  const maxUploadBytes = readNumber(value.maxUploadBytes);
  const supportState = readString(value.supportState);
  const lastHeartbeatAt = readString(value.lastHeartbeatAt);
  return {
    id,
    name: readString(value.name) ?? readString(value.label) ?? id,
    status: readString(value.status) ?? readString(value.state) ?? "unknown",
    capabilities: readStringArray(value.capabilities),
    ...(purpose === undefined ? {} : { purpose }),
    ...(version === undefined ? {} : { version }),
    ...(maxUploadBytes === undefined ? {} : { maxUploadBytes }),
    ...(supportState === undefined ? {} : { supportState }),
    ...(lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt }),
  };
}

function normalizeModelProfile(value: unknown): ModelProfileSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id) ?? readString(value.profileId);
  if (id === undefined) {
    return null;
  }
  const provider = readString(value.provider) ?? "unknown-provider";
  const model = readString(value.model) ?? "unknown-model";
  const label =
    readString(value.label) ??
    readString(value.displayName) ??
    readString(value.name) ??
    `${provider} / ${model}`;
  const runnerId = readString(value.runnerId);
  return {
    id,
    provider,
    model,
    label,
    enabled: readBoolean(value.enabled) ?? true,
    ...(runnerId === undefined ? {} : { runnerId }),
    ...(isRecord(value.reasoningOptions) ? { reasoningOptions: value.reasoningOptions } : {}),
  };
}

function normalizeWorkspace(value: unknown): WorkspaceDetail | null {
  const record = unwrapRecord(value, ["workspace"]);
  const id = readString(record.id) ?? readString(record.workspaceId);
  if (id === undefined) {
    return null;
  }
  const name = readString(record.name) ?? readString(record.title) ?? id;
  const goal = readString(record.goal);
  const completionCriteria = readString(record.completionCriteria);
  const runnerId = readString(record.runnerId);
  const agentProfileId =
    readString(record.agentProfileId) ??
    readString(record.modelProfileId) ??
    readString(record.agentConfigId);
  const teamId = readString(record.teamId);
  const updatedAt =
    readString(record.updatedAt) ??
    readString(record.createdAt) ??
    readString(record.lastActivityAt);
  const revision = readNumber(record.revision);
  const operator = isRecord(record.currentOperator) ? record.currentOperator : undefined;
  const operatorId = operator === undefined ? undefined : readString(operator.operatorId);
  const operatorEpoch = operator === undefined ? undefined : readNumber(operator.operatorEpoch);
  return {
    id,
    name,
    kind: normalizeKind(record.kind),
    status: normalizeWorkspaceStatus(record.status),
    ...(goal === undefined ? {} : { goal }),
    ...(completionCriteria === undefined ? {} : { completionCriteria }),
    ...(runnerId === undefined ? {} : { runnerId }),
    ...(agentProfileId === undefined ? {} : { agentProfileId }),
    ...(teamId === undefined ? {} : { teamId }),
    ...(revision === undefined ? {} : { revision }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(operatorId !== undefined && operatorEpoch !== undefined
      ? { currentOperator: { operatorId, operatorEpoch } }
      : {}),
  };
}

function normalizeApprovalState(value: unknown): ApprovalState {
  switch (value) {
    case "pending":
    case "approved":
    case "rejected":
    case "expired":
    case "invalidated":
      return value;
    default:
      return "unknown";
  }
}

function normalizeActionProposal(value: unknown): ActionProposalView {
  const record = isRecord(value) ? value : {};
  const displayArgs = isRecord(record.displayArgs)
    ? record.displayArgs
    : typeof record.displayArgs === "string"
      ? { description: record.displayArgs }
      : {};
  const runId = readString(record.runId);
  const workspaceId = readString(record.workspaceId);
  return {
    toolName: readString(record.toolName) ?? "unknown-tool",
    displayArgs,
    secretRefs: readStringArray(record.secretRefs),
    actionDigest: readString(record.actionDigest) ?? "",
    purpose: readString(record.purpose) ?? "No purpose was reported.",
    impact: readString(record.impact) ?? "No impact summary was reported.",
    risk: readString(record.risk) ?? "unknown",
    ...(runId === undefined ? {} : { runId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

function normalizeApproval(value: unknown): ApprovalView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id) ?? readString(value.approvalId);
  if (id === undefined) {
    return null;
  }
  const proposal = normalizeActionProposal(value.actionProposal);
  const expiresAt = readString(value.expiresAt) ?? null;
  const createdAt = readString(value.createdAt);
  const decidedBy = readString(value.decidedBy);
  const reason = readString(value.reason);
  const runId = readString(value.runId) ?? proposal.runId;
  const workspaceId = readString(value.workspaceId) ?? proposal.workspaceId;
  const policyRevision = readNumber(value.policyRevision);
  return {
    id,
    actionProposal: proposal,
    requesterId: readString(value.requesterId) ?? "unknown-requester",
    requiredApproverPolicy: isRecord(value.requiredApproverPolicy)
      ? value.requiredApproverPolicy
      : {},
    policyRevision: policyRevision ?? null,
    state: normalizeApprovalState(value.state),
    expiresAt,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(decidedBy === undefined ? {} : { decidedBy }),
    ...(reason === undefined ? {} : { reason }),
    ...(runId === undefined ? {} : { runId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

function normalizeAvailability(value: unknown): ArtifactAvailability {
  if (value === "missing" || value === "unavailable") {
    return "missing";
  }
  if (value === "available" || value === "ready") {
    return "available";
  }
  return "unknown";
}

function normalizeArtifactRecord(
  value: unknown,
  parent: Record<string, unknown> | null = null,
  fallbackVersion = 1,
): ArtifactView | null {
  if (!isRecord(value)) {
    return null;
  }
  const parentId = parent === null ? undefined : readString(parent.id);
  const artifactId = readString(value.artifactId) ?? parentId ?? readString(value.id);
  const artifactVersionId = readString(value.artifactVersionId);
  const id = readString(value.id) ?? artifactVersionId ?? artifactId;
  if (id === undefined) {
    return null;
  }
  const name =
    readString(value.name) ??
    readString(value.artifactName) ??
    readString(value.fileName) ??
    (parent === null ? undefined : readString(parent.name)) ??
    id;
  const version = readNumber(value.version) ?? fallbackVersion;
  const mediaType =
    readString(value.mediaType) ??
    readString(value.contentType) ??
    (parent === null ? undefined : readString(parent.mediaType)) ??
    "application/octet-stream";
  const size = readNumber(value.size) ?? (parent === null ? undefined : readNumber(parent.size));
  const sha256 =
    readString(value.sha256) ?? (parent === null ? undefined : readString(parent.sha256));
  const kind =
    readString(value.kind) ??
    readString(value.originType) ??
    (parent === null ? undefined : readString(parent.kind)) ??
    "artifact";
  const sourceSummary =
    readString(value.sourceSummary) ??
    (parent === null ? undefined : readString(parent.sourceSummary));
  const runId = readString(value.runId) ?? (parent === null ? undefined : readString(parent.runId));
  const createdAt =
    readString(value.createdAt) ?? (parent === null ? undefined : readString(parent.createdAt));
  const availability = normalizeAvailability(
    value.availability ?? value.state ?? (parent === null ? undefined : parent.availability),
  );
  return {
    id,
    name,
    version,
    mediaType,
    size: size ?? null,
    kind,
    availability,
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(artifactVersionId === undefined ? {} : { artifactVersionId }),
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(sourceSummary === undefined ? {} : { sourceSummary }),
    ...(runId === undefined ? {} : { runId }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function normalizeArtifacts(value: unknown): readonly ArtifactView[] {
  const items = itemsFrom(value);
  if (items === null) {
    throw new RunnerApiError("Runner API returned an unexpected artifact list shape.");
  }
  const artifacts: ArtifactView[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const versions = asArray(item.versions);
    if (versions.length === 0) {
      const artifact = normalizeArtifactRecord(item);
      if (artifact !== null) {
        artifacts.push(artifact);
      }
      continue;
    }
    for (const [index, version] of versions.entries()) {
      const artifact = normalizeArtifactRecord(version, item, index + 1);
      if (artifact !== null) {
        artifacts.push(artifact);
      }
    }
  }
  return artifacts;
}

function normalizeUsage(value: unknown): UsageSummary {
  if (!isRecord(value)) {
    return { available: false, reason: "The Runner did not report usage in a readable form." };
  }
  if (value.reliability === "unavailable" || value.available === false) {
    const provider = readString(value.provider);
    return {
      available: false,
      reason: readString(value.reason) ?? "Upstream usage data is unavailable.",
      ...(provider === undefined ? {} : { provider }),
    };
  }
  if (value.available !== true && value.reliability === undefined) {
    return { available: false, reason: "Upstream usage data is unavailable." };
  }
  const provider = readString(value.provider);
  const inputTokens = readNumber(value.inputTokens);
  const outputTokens = readNumber(value.outputTokens);
  const costAmount = readNumber(value.costAmount);
  const costCurrency = readString(value.costCurrency);
  const reliability = readString(value.reliability);
  return {
    available: true,
    ...(provider === undefined ? {} : { provider }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costAmount === undefined ? {} : { costAmount }),
    ...(costCurrency === undefined ? {} : { costCurrency }),
    ...(reliability === undefined ? {} : { reliability }),
  };
}

function normalizeBackupStatus(value: unknown): BackupStatus {
  if (!isRecord(value)) {
    return { state: "unavailable", message: "The Runner did not report backup state." };
  }
  const rawState = value.state;
  const state =
    rawState === "running" ||
    rawState === "succeeded" ||
    rawState === "failed" ||
    rawState === "never_run"
      ? rawState
      : "unavailable";
  const message = readString(value.message);
  const lastBackupAt = readString(value.lastBackupAt) ?? readString(value.createdAt);
  const manifestId = readString(value.manifestId) ?? readString(value.id);
  const manifestDigest = readString(value.manifestDigest) ?? readString(value.digest);
  return {
    state,
    ...(message === undefined ? {} : { message }),
    ...(lastBackupAt === undefined ? {} : { lastBackupAt }),
    ...(manifestId === undefined ? {} : { manifestId }),
    ...(manifestDigest === undefined ? {} : { manifestDigest }),
  };
}

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Command payload numbers must be finite.");
  }
  return JSON.stringify(value) ?? "null";
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function commandEnvelope(
  payload: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const commandId = crypto.randomUUID();
  const payloadDigest = `sha256:${await sha256Hex(new TextEncoder().encode(canonicalize(payload)).buffer)}`;
  return { schemaVersion: 1, commandId, payloadDigest, ...payload };
}

export function normalizeRunnerBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_RUNNER_API_URL;
  }
  try {
    const url = new URL(trimmed);
    if (url.pathname === "/" || url.pathname.length === 0) {
      url.pathname = "/v1";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function resolveRunnerApiUrl(): string {
  if (typeof window !== "undefined") {
    const queryValue = new URLSearchParams(window.location.search).get("runnerApi");
    if (queryValue !== null) {
      return normalizeRunnerBaseUrl(queryValue);
    }
    const globalValue = (window as Window & { readonly __UNSPOOL_RUNNER_URL__?: unknown })
      .__UNSPOOL_RUNNER_URL__;
    if (typeof globalValue === "string" && globalValue.trim().length > 0) {
      return normalizeRunnerBaseUrl(globalValue);
    }
  }
  const configured: unknown = import.meta.env.VITE_UNSPOOL_RUNNER_URL;
  return normalizeRunnerBaseUrl(
    typeof configured === "string" ? configured : DEFAULT_RUNNER_API_URL,
  );
}

export function resolveRunnerToken(): string | undefined {
  if (typeof window !== "undefined") {
    const globalValue = (window as Window & { readonly __UNSPOOL_RUNNER_TOKEN__?: unknown })
      .__UNSPOOL_RUNNER_TOKEN__;
    if (typeof globalValue === "string" && globalValue.trim().length > 0) return globalValue;
    const queryValue = new URLSearchParams(window.location.search).get("runnerToken");
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (loopback && queryValue !== null && queryValue.trim().length > 0) return queryValue;
  }
  const configured: unknown = import.meta.env.VITE_UNSPOOL_RUNNER_TOKEN;
  return typeof configured === "string" && configured.trim().length > 0 ? configured : undefined;
}

export function createRunnerClient(options: RunnerClientOptions = {}): RunnerClient {
  const baseUrl = normalizeRunnerBaseUrl(options.baseUrl ?? resolveRunnerApiUrl());
  const token = options.token ?? resolveRunnerToken();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const authorization = token === undefined ? {} : { Authorization: `Bearer ${token}` };

  async function requestJson(path: string, requestOptions: RequestOptions = {}): Promise<unknown> {
    const headers = new Headers({
      Accept: requestOptions.accept ?? "application/json",
      ...authorization,
    });
    let body: BodyInit | undefined;
    if (requestOptions.form !== undefined) {
      body = requestOptions.form;
    } else if (requestOptions.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(requestOptions.json);
    }
    if (requestOptions.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", requestOptions.idempotencyKey);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: requestOptions.method ?? "GET",
        headers,
        body: body ?? null,
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new RunnerApiError(
        `Runner API is unavailable at ${baseUrl}. ${detail === "The operation was aborted." ? "The request timed out." : detail}`,
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail = `Runner API returned HTTP ${response.status} ${response.statusText}.`;
      let code: string | null = null;
      let retryable = response.status >= 500;
      try {
        const problem: unknown = await response.json();
        if (isRecord(problem)) {
          const problemDetail = readString(problem.detail);
          code = readString(problem.code) ?? null;
          retryable = readBoolean(problem.retryable) ?? retryable;
          if (problemDetail !== undefined) {
            detail = problemDetail;
          }
        }
      } catch {
        // The response was not a Problem JSON document; keep the HTTP status text.
      }
      throw new RunnerApiError(detail, {
        status: response.status,
        code,
        retryable,
      });
    }

    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (text.trim().length === 0) {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RunnerApiError("Runner API returned a response that was not valid JSON.");
    }
  }

  async function listItems(path: string, label: string): Promise<readonly unknown[]> {
    const items = itemsFrom(await requestJson(path));
    if (items === null) {
      throw new RunnerApiError(`Runner API returned an unexpected ${label} list shape.`);
    }
    return items;
  }

  async function startRunCommand(
    workspaceId: string,
    input: StartRunInput,
    operatorEpoch: number,
  ): Promise<RunSummary | null> {
    const payload: Record<string, unknown> = {
      ...(input.body === undefined || input.body.trim().length === 0
        ? {}
        : { body: input.body.trim() }),
      ...(input.contextSnapshotId === undefined
        ? {}
        : { contextSnapshotId: input.contextSnapshotId }),
    };
    const envelope = await commandEnvelope(payload);
    const body = { ...envelope, operatorEpoch };
    const response = await requestJson(`/workspaces/${encodeURIComponent(workspaceId)}/runs`, {
      method: "POST",
      json: body,
      idempotencyKey: String(envelope.commandId),
    });
    const record = unwrapRecord(response, ["run"]);
    return isRecord(record) && readString(record.id) !== undefined ? normalizeRun(record) : null;
  }

  async function postRunCommand(
    workspaceId: string,
    runId: string,
    suffix: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const envelope = await commandEnvelope(payload);
    await requestJson(
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/${suffix}`,
      {
        method: "POST",
        json: envelope,
        idempotencyKey: String(envelope.commandId),
      },
    );
  }

  const client: RunnerClient = {
    baseUrl,

    async getHealth(): Promise<RunnerHealth> {
      return normalizeHealth(await requestJson("/health", { accept: "application/json" }));
    },

    async listRunners(): Promise<readonly RunnerSummary[]> {
      const items = await listItems("/runners", "Runner");
      return items
        .map(normalizeRunner)
        .filter((runner): runner is RunnerSummary => runner !== null);
    },

    async listModelProfiles(runnerId: string): Promise<readonly ModelProfileSummary[]> {
      const items = await listItems(
        `/runners/${encodeURIComponent(runnerId)}/model-profiles`,
        "model profile",
      );
      return items
        .map(normalizeModelProfile)
        .filter((profile): profile is ModelProfileSummary => profile !== null);
    },

    async listPersonalTasks(): Promise<readonly PersonalTaskSummary[]> {
      const items = await listItems("/personal-tasks", "personal task");
      return items
        .map(normalizeWorkspace)
        .filter((workspace): workspace is WorkspaceDetail => workspace !== null);
    },

    async getPersonalTask(workspaceId: string): Promise<WorkspaceDetail> {
      const workspace = normalizeWorkspace(
        await requestJson(`/personal-tasks/${encodeURIComponent(workspaceId)}`),
      );
      if (workspace === null) {
        throw new RunnerApiError("Runner API returned an unexpected personal task shape.");
      }
      return workspace;
    },

    async createPersonalTask(input: CreatePersonalTaskInput): Promise<WorkspaceDetail> {
      const payload: Record<string, unknown> = {
        name: input.name,
        goal: input.goal,
        runnerId: input.runnerId,
        agentProfileId: input.agentProfileId,
        ...(input.completionCriteria === undefined
          ? {}
          : { completionCriteria: input.completionCriteria }),
      };
      const envelope = await commandEnvelope(payload);
      const workspace = normalizeWorkspace(
        await requestJson("/personal-tasks", {
          method: "POST",
          json: envelope,
          idempotencyKey: String(envelope.commandId),
        }),
      );
      if (workspace === null) {
        throw new RunnerApiError("Runner API did not return the created personal task.");
      }
      return workspace;
    },

    async listRuns(workspaceId: string): Promise<readonly RunSummary[]> {
      const items = await listItems(`/workspaces/${encodeURIComponent(workspaceId)}/runs`, "run");
      return items.map(normalizeRun).filter((run): run is RunSummary => run !== null);
    },

    async getRun(workspaceId: string, runId: string): Promise<RunDetail> {
      const run = normalizeRunDetail(
        await requestJson(
          `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}`,
        ),
      );
      if (run === null) {
        throw new RunnerApiError("Runner API returned an unexpected run shape.");
      }
      return run;
    },

    startRun: startRunCommand,

    async steerRun(
      workspaceId: string,
      runId: string,
      body: string,
      operatorEpoch: number,
    ): Promise<void> {
      await postRunCommand(workspaceId, runId, "steer", {
        operatorEpoch,
        body: body.trim(),
      });
    },

    async queueFollowUp(
      workspaceId: string,
      runId: string,
      body: string,
      operatorEpoch: number,
    ): Promise<void> {
      await postRunCommand(workspaceId, runId, "follow-ups", {
        operatorEpoch,
        body: body.trim(),
      });
    },

    async stopRun(workspaceId: string, runId: string, operatorEpoch: number): Promise<void> {
      await postRunCommand(workspaceId, runId, "stop", {
        operatorEpoch,
        confirmedStop: true,
      });
    },

    async assessRunResult(
      workspaceId: string,
      runId: string,
      result: "complete" | "partial" | "incomplete" | "failed" | "cancelled",
      reason?: string,
    ): Promise<void> {
      const payload: Record<string, unknown> = {
        result,
        ...(reason === undefined ? {} : { reason }),
      };
      const envelope = await commandEnvelope(payload);
      await requestJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/result`,
        {
          method: "POST",
          json: envelope,
          idempotencyKey: String(envelope.commandId),
        },
      );
    },

    subscribeWorkspaceEvents(
      workspaceId: string,
      afterSequence: number,
      handlers: {
        readonly onEvent: (event: TimelineEvent) => void;
        readonly onOpen: () => void;
        readonly onError: () => void;
      },
    ): () => void {
      const after = afterSequence > 0 ? `?after=${String(afterSequence)}` : "";
      if (token !== undefined) {
        const controller = new AbortController();
        let active = true;
        void (async () => {
          try {
            const response = await fetchImpl(
              `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/events${after}`,
              {
                headers: { Accept: "text/event-stream", ...authorization },
                signal: controller.signal,
              },
            );
            if (!response.ok || response.body === null) throw new Error("SSE request failed");
            handlers.onOpen();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffered = "";
            while (active) {
              const next = await reader.read();
              if (next.done) break;
              buffered += decoder.decode(next.value, { stream: true });
              const frames = buffered.split(/\r?\n\r?\n/);
              buffered = frames.pop() ?? "";
              for (const frame of frames) {
                const data = frame
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.slice(5).trimStart())
                  .join("\n");
                if (data.length === 0) continue;
                try {
                  const event = normalizeTimelineEvent(JSON.parse(data) as unknown);
                  if (event !== null) handlers.onEvent(event);
                } catch {
                  // Ignore malformed frames without closing an otherwise healthy stream.
                }
              }
            }
          } catch (cause) {
            if (active && !(cause instanceof DOMException && cause.name === "AbortError"))
              handlers.onError();
          }
        })();
        return () => {
          active = false;
          controller.abort();
        };
      }
      if (typeof EventSource === "undefined") {
        handlers.onError();
        return () => {};
      }
      const source = new EventSource(
        `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/events${after}`,
        { withCredentials: false },
      );
      const dispatch = (message: MessageEvent<string>): void => {
        try {
          const event = normalizeTimelineEvent(JSON.parse(message.data) as unknown);
          if (event !== null) {
            handlers.onEvent(event);
          }
        } catch {
          // A malformed event must not tear down the live connection.
        }
      };
      source.onopen = handlers.onOpen;
      source.onerror = handlers.onError;
      source.onmessage = dispatch;
      for (const eventName of EVENT_NAMES) {
        source.addEventListener(eventName, (event) => {
          if (event instanceof MessageEvent) {
            dispatch(event as MessageEvent<string>);
          }
        });
      }
      return () => {
        source.close();
      };
    },

    async listApprovals(): Promise<readonly ApprovalView[]> {
      const items = await listItems("/approvals", "approval");
      return items
        .map(normalizeApproval)
        .filter((approval): approval is ApprovalView => approval !== null);
    },

    async decideApproval(
      approvalId: string,
      decision: "approved" | "rejected",
      actionDigest: string,
      reason?: string,
    ): Promise<ApprovalView> {
      const payload: Record<string, unknown> = {
        decision,
        actionDigest,
        ...(reason === undefined || reason.trim().length === 0 ? {} : { reason: reason.trim() }),
      };
      const envelope = await commandEnvelope(payload);
      const approval = normalizeApproval(
        await requestJson(`/approvals/${encodeURIComponent(approvalId)}/decision`, {
          method: "POST",
          json: envelope,
          idempotencyKey: String(envelope.commandId),
        }),
      );
      if (approval === null) {
        throw new RunnerApiError("Runner API did not return the decided approval.");
      }
      return approval;
    },

    async listArtifacts(workspaceId: string): Promise<readonly ArtifactView[]> {
      return normalizeArtifacts(
        await requestJson(`/workspaces/${encodeURIComponent(workspaceId)}/artifacts`),
      );
    },

    async uploadArtifact(
      workspaceId: string,
      file: File,
      onPhase?: (phase: "hashing" | "uploading") => void,
    ): Promise<ArtifactView> {
      onPhase?.("hashing");
      const hash = await sha256Hex(await file.arrayBuffer());
      onPhase?.("uploading");
      const metadata = {
        name: file.name,
        mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
        size: file.size,
        sha256: `sha256:${hash}`,
        kind: "reference",
        sourceSummary: "Uploaded from the Unspool desktop artifact panel.",
      };
      const form = new FormData();
      form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.set("content", file, file.name);
      const response = unwrapRecord(
        await requestJson(`/workspaces/${encodeURIComponent(workspaceId)}/artifacts`, {
          method: "POST",
          form,
          idempotencyKey: crypto.randomUUID(),
        }),
        ["artifact", "version"],
      );
      const artifact = normalizeArtifactRecord(response);
      if (artifact === null) {
        throw new RunnerApiError("Runner API did not return the uploaded artifact.");
      }
      return artifact;
    },

    async downloadArtifact(workspaceId: string, artifact: ArtifactView): Promise<Blob> {
      const targetId = artifact.artifactId ?? artifact.id;
      const response = await fetchImpl(
        `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(targetId)}/content`,
        {
          method: "GET",
          credentials: "omit",
          headers: authorization,
        },
      );
      if (!response.ok) {
        throw new RunnerApiError(
          `Artifact download failed with HTTP ${response.status} ${response.statusText}.`,
          { status: response.status, retryable: response.status >= 500 },
        );
      }
      return response.blob();
    },
  };

  return client;
}

export function defaultUploadLimit(health: RunnerHealth | null): number {
  return health?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
}

export function normalizeUsageResult(value: unknown): UsageSummary {
  return normalizeUsage(value);
}

export function normalizeBackupResult(value: unknown): BackupStatus {
  return normalizeBackupStatus(value);
}
