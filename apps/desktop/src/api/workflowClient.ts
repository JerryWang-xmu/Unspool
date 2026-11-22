import {
  normalizeRunnerBaseUrl,
  RunnerApiError,
  resolveRunnerApiUrl,
  resolveRunnerToken,
} from "./runnerClient";

export type WorkflowRecord = Readonly<Record<string, unknown>>;
export type ArchiveManifest = WorkflowRecord;
export type ConclusionKind = "fact" | "assumption" | "decision";
export type ConclusionState = "unverified" | "confirmed" | "review_required" | "invalid";
export type ConclusionReviewState = "confirmed" | "review_required" | "invalid";
export type CompletionResult = "complete" | "partial" | "incomplete" | "failed" | "cancelled";

export interface WorkflowPrincipal {
  readonly id: string;
  readonly displayName: string;
}

export interface TeamRecord {
  readonly id: string;
  readonly name: string;
  readonly betaEnabled: boolean;
  readonly defaultPolicyRevision: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly ownerId: string | null;
}

export interface InviteHandoffInput {
  readonly recipientId: string;
  readonly reason?: string;
}

export interface HandoffInvitationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly fromOperatorId: string;
  readonly recipientId: string;
  readonly summarySnapshotId: string;
  readonly baseRevision: number;
  readonly status: string;
  readonly reason?: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface HandoffPreparation {
  readonly id: string;
  readonly handoffId: string;
  readonly recipientId: string;
  readonly status: string;
  readonly readOnlyConversationId: string;
  readonly asOfRevision: number;
  readonly latestRevision: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly summary: WorkflowRecord;
}

export interface HandoffQuestionInput {
  readonly question: string;
  readonly asOfRevision: number;
}

export interface HandoffAnswer {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly answerKind: string;
  readonly asOfRevision: number;
  readonly citations: readonly WorkflowRecord[];
  readonly createdAt: string;
}

export interface HandoffRefresh {
  readonly refreshedAt: string;
  readonly latestRecordedAt: string;
  readonly latestRevision: number;
  readonly asOfRevision: number;
  readonly changed: boolean;
  readonly goal: string;
  readonly unresolvedIssues: readonly WorkflowRecord[];
}

export interface HandoffAcceptance {
  readonly id: string;
  readonly status: string;
  readonly acceptedAt: string;
  readonly operatorId?: string;
  readonly previousOperatorId?: string;
  readonly operatorEpoch?: number;
}

export interface HandoffRejection {
  readonly id: string;
  readonly status: string;
  readonly reason: string;
}

export interface ConclusionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ConclusionKind | string;
  readonly body: string;
  readonly state: ConclusionState | string;
  readonly scope: string;
  readonly proposedBy: string;
  readonly currentVersion: number;
  readonly sourceVersionIds: readonly string[];
  readonly lastReviewedAt?: string;
  readonly confirmedBy?: string;
  readonly confirmedAt?: string;
}

export interface ProposeConclusionInput {
  readonly kind: ConclusionKind | string;
  readonly body: string;
  readonly scope: string;
  readonly sourceVersionIds: readonly string[];
}

export interface ConclusionReviewInput {
  readonly newState: ConclusionReviewState;
  readonly reason: string;
  readonly sourceVersionIds?: readonly string[];
}

export interface ConclusionReviewRecord {
  readonly id: string;
  readonly conclusionId: string;
  readonly previousState: string;
  readonly newState: string;
  readonly reason: string;
  readonly sourceVersionIds: readonly string[];
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

export interface ConclusionReviewResult {
  readonly conclusion: ConclusionRecord;
  readonly review: ConclusionReviewRecord;
}

export interface ArchiveExportRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly scope: string;
  readonly formatVersion: number;
  readonly manifestBlobId: string;
  readonly missingItems: readonly string[];
  readonly unknownItems: readonly string[];
  readonly exportedBy: string;
  readonly exportedAt: string;
}

export interface CreateArchiveExportInput {
  readonly scope: string;
  readonly runIds?: readonly string[];
}

export interface ArchiveArtifactRecord {
  readonly id: string;
  readonly name: string;
  readonly runId?: string;
  readonly sha256: string;
  readonly size: number;
  readonly path: string;
  readonly status: string;
}

export interface ArchiveSearchResult {
  readonly conclusions: readonly ConclusionRecord[];
  readonly artifacts: readonly ArchiveArtifactRecord[];
}

export interface ArchivedWorkspace {
  readonly id: string;
  readonly status: string;
  readonly revision: number;
  readonly archivedAt?: string;
}

export interface CompletionAssessmentInput {
  readonly runId: string;
  readonly result: CompletionResult;
  readonly reason?: string;
  readonly evidenceExceptionReason?: string;
}

export interface CompletionAssessmentResult {
  readonly assessment: WorkflowRecord;
  readonly coverage: WorkflowRecord;
  readonly blockingConclusionIds: readonly string[];
  readonly exception?: WorkflowRecord;
}

export interface WorkflowClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface WorkflowClient {
  readonly baseUrl: string;
  getMe(): Promise<WorkflowPrincipal>;
  listTeams(): Promise<readonly TeamRecord[]>;
  inviteHandoff(workspaceId: string, input: InviteHandoffInput): Promise<HandoffInvitationRecord>;
  prepareHandoff(workspaceId: string, handoffId: string): Promise<HandoffPreparation>;
  getPreparation(workspaceId: string, handoffId: string): Promise<HandoffPreparation>;
  askHandoffQuestion(
    workspaceId: string,
    handoffId: string,
    input: HandoffQuestionInput,
  ): Promise<HandoffAnswer>;
  refreshHandoff(workspaceId: string, handoffId: string): Promise<HandoffRefresh>;
  recordUnresolvedIssue(
    workspaceId: string,
    handoffId: string,
    input: { body: string; visibility: "private" | "shared"; status: "open" },
  ): Promise<WorkflowRecord>;
  acceptHandoff(
    workspaceId: string,
    handoffId: string,
    expectedRevision: number,
  ): Promise<HandoffAcceptance>;
  rejectHandoff(workspaceId: string, handoffId: string, reason: string): Promise<HandoffRejection>;
  listConclusions(workspaceId: string): Promise<readonly ConclusionRecord[]>;
  proposeConclusion(workspaceId: string, input: ProposeConclusionInput): Promise<ConclusionRecord>;
  reviewConclusion(
    workspaceId: string,
    conclusionId: string,
    input: ConclusionReviewInput,
  ): Promise<ConclusionReviewResult>;
  listReviewHistory(
    workspaceId: string,
    conclusionId: string,
  ): Promise<readonly ConclusionReviewRecord[]>;
  listArchiveExports(workspaceId: string): Promise<readonly ArchiveExportRecord[]>;
  createArchiveExport(
    workspaceId: string,
    input: CreateArchiveExportInput,
  ): Promise<ArchiveExportRecord>;
  getArchiveManifest(workspaceId: string, exportId: string): Promise<ArchiveManifest>;
  searchArchive(workspaceId: string, query: string): Promise<ArchiveSearchResult>;
  archiveWorkspace(workspaceId: string, expectedRevision: number): Promise<ArchivedWorkspace>;
  assessCompletion(
    workspaceId: string,
    input: CompletionAssessmentInput,
  ): Promise<CompletionAssessmentResult>;
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
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

async function payloadDigest(payload: WorkflowRecord): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalize(payload)),
  );
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function commandEnvelope(
  payload: WorkflowRecord,
): Promise<{ commandId: string; body: string }> {
  const commandId = globalThis.crypto.randomUUID();
  const body = JSON.stringify({
    schemaVersion: 1,
    commandId,
    payloadDigest: await payloadDigest(payload),
    ...payload,
  });
  return { commandId, body };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RunnerApiError(`Runner returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function entity(value: unknown, key: string): Record<string, unknown> {
  const root = record(value, key);
  const nested = root[key];
  return nested === undefined ? root : record(nested, key);
}

function records(value: unknown, key: string, label: string): readonly Record<string, unknown>[] {
  const root = record(value, label);
  const items = root[key];
  return Array.isArray(items) ? items.map((item) => record(item, label)) : [];
}

export function createWorkflowClient(options: WorkflowClientOptions = {}): WorkflowClient {
  const baseUrl = normalizeRunnerBaseUrl(options.baseUrl ?? resolveRunnerApiUrl());
  const token = options.token ?? resolveRunnerToken();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request(
    path: string,
    init: {
      readonly method?: string;
      readonly payload?: WorkflowRecord;
      readonly revision?: number;
    } = {},
  ): Promise<unknown> {
    const headers = new Headers({
      Accept: "application/json",
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    });
    let body: string | null = null;
    if (init.payload !== undefined) {
      const envelope = await commandEnvelope(init.payload);
      headers.set("Content-Type", "application/json");
      headers.set("Idempotency-Key", envelope.commandId);
      body = envelope.body;
    }
    if (init.revision !== undefined) headers.set("If-Match", `"${init.revision}"`);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body,
      credentials: "omit",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      const problem =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      throw new RunnerApiError(
        typeof problem.detail === "string"
          ? problem.detail
          : `Runner request failed with HTTP ${response.status}.`,
        {
          status: typeof problem.status === "number" ? problem.status : response.status,
          code: typeof problem.code === "string" ? problem.code : null,
          retryable: problem.retryable === true,
        },
      );
    }
    return parsed;
  }

  return {
    baseUrl,
    async getMe() {
      const principal = entity(await request("/me"), "principal");
      return {
        id: String(principal.id),
        displayName: String(principal.displayName),
      };
    },
    async listTeams() {
      return records(await request("/teams"), "teams", "teams") as unknown as readonly TeamRecord[];
    },
    async inviteHandoff(workspaceId, input) {
      const result = await request(`/workspaces/${workspaceId}/handoffs`, {
        method: "POST",
        payload: {
          recipientId: input.recipientId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      });
      return record(result, "handoff invitation") as unknown as HandoffInvitationRecord;
    },
    async prepareHandoff(workspaceId, handoffId) {
      const result = await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/prepare`, {
        method: "POST",
        payload: {},
      });
      return record(result, "handoff preparation") as unknown as HandoffPreparation;
    },
    async getPreparation(workspaceId, handoffId) {
      const result = await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/preparation`);
      return record(result, "handoff preparation") as unknown as HandoffPreparation;
    },
    async askHandoffQuestion(workspaceId, handoffId, input) {
      const result = await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/questions`, {
        method: "POST",
        payload: {
          question: input.question,
          asOfRevision: input.asOfRevision,
        },
      });
      return record(result, "handoff answer") as unknown as HandoffAnswer;
    },
    async refreshHandoff(workspaceId, handoffId) {
      const result = await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/refresh`, {
        method: "POST",
        payload: {},
      });
      return record(result, "handoff refresh") as unknown as HandoffRefresh;
    },
    async recordUnresolvedIssue(workspaceId, handoffId, input) {
      return record(
        await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/unresolved-issues`, {
          method: "POST",
          payload: { body: input.body, visibility: input.visibility, status: input.status },
        }),
        "unresolved issue",
      );
    },
    async acceptHandoff(workspaceId, handoffId, expectedRevision) {
      const result = await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/accept`, {
        method: "POST",
        payload: {},
        revision: expectedRevision,
      });
      return record(result, "handoff acceptance") as unknown as HandoffAcceptance;
    },
    async rejectHandoff(workspaceId, handoffId, reason) {
      const result = await request(`/workspaces/${workspaceId}/handoffs/${handoffId}/reject`, {
        method: "POST",
        payload: { reason },
      });
      return record(result, "handoff rejection") as unknown as HandoffRejection;
    },
    async listConclusions(workspaceId) {
      return records(
        await request(`/workspaces/${workspaceId}/conclusions`),
        "items",
        "conclusions",
      ) as unknown as readonly ConclusionRecord[];
    },
    async proposeConclusion(workspaceId, input) {
      const result = await request(`/workspaces/${workspaceId}/conclusions`, {
        method: "POST",
        payload: {
          kind: input.kind,
          body: input.body,
          scope: input.scope,
          sourceVersionIds: [...input.sourceVersionIds],
        },
      });
      return record(result, "conclusion") as unknown as ConclusionRecord;
    },
    async reviewConclusion(workspaceId, conclusionId, input) {
      const result = await request(
        `/workspaces/${workspaceId}/conclusions/${conclusionId}/review`,
        {
          method: "POST",
          payload: {
            newState: input.newState,
            reason: input.reason,
            ...(input.sourceVersionIds === undefined
              ? {}
              : { sourceVersionIds: [...input.sourceVersionIds] }),
          },
        },
      );
      return record(result, "conclusion review") as unknown as ConclusionReviewResult;
    },
    async listReviewHistory(workspaceId, conclusionId) {
      return records(
        await request(`/workspaces/${workspaceId}/conclusions/${conclusionId}/reviews`),
        "items",
        "conclusion reviews",
      ) as unknown as readonly ConclusionReviewRecord[];
    },
    async listArchiveExports(workspaceId) {
      return records(
        await request(`/workspaces/${workspaceId}/archive-exports`),
        "items",
        "archive exports",
      ) as unknown as readonly ArchiveExportRecord[];
    },
    async createArchiveExport(workspaceId, input) {
      const result = await request(`/workspaces/${workspaceId}/archive-exports`, {
        method: "POST",
        payload: {
          scope: input.scope,
          ...(input.runIds === undefined ? {} : { runIds: [...input.runIds] }),
        },
      });
      return record(result, "archive export") as unknown as ArchiveExportRecord;
    },
    async getArchiveManifest(workspaceId, exportId) {
      const result = await request(
        `/workspaces/${workspaceId}/archive-exports/${exportId}/manifest`,
      );
      return record(result, "archive manifest") as unknown as ArchiveManifest;
    },
    async searchArchive(workspaceId, query) {
      const result = await request(
        `/workspaces/${workspaceId}/archive-search?q=${encodeURIComponent(query)}`,
      );
      return record(result, "archive search") as unknown as ArchiveSearchResult;
    },
    async archiveWorkspace(workspaceId, expectedRevision) {
      const result = await request(`/workspaces/${workspaceId}/archive`, {
        method: "POST",
        payload: {},
        revision: expectedRevision,
      });
      return entity(result, "workspace") as unknown as ArchivedWorkspace;
    },
    async assessCompletion(workspaceId, input) {
      const result = await request(`/workspaces/${workspaceId}/completion-assessments`, {
        method: "POST",
        payload: {
          runId: input.runId,
          result: input.result,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.evidenceExceptionReason === undefined
            ? {}
            : { evidenceExceptionReason: input.evidenceExceptionReason }),
        },
      });
      return record(result, "completion assessment") as unknown as CompletionAssessmentResult;
    },
  };
}
