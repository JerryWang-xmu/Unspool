import type {
  CollaborationClient,
  CollaborationInput,
  ContextItem,
  ContextVersion,
  ContextVersionInput,
  CreateSharedWorkspaceInput,
  SharePreview,
  TeamMember,
  WorkspaceMember,
} from "./collaborationTypes";
import {
  createRunnerClient,
  normalizeRunnerBaseUrl,
  RunnerApiError,
  resolveRunnerApiUrl,
  resolveRunnerToken,
} from "./runnerClient";
import type { WorkspaceDetail } from "./types";

export interface CollaborationClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

async function digest(value: unknown): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RunnerApiError(`Runner returned an invalid ${label}.`);
  return value as Record<string, unknown>;
}

function entity(value: unknown, key: string): Record<string, unknown> {
  return record(record(value, key)[key] ?? value, key);
}

function workspace(value: unknown): WorkspaceDetail {
  const item = entity(value, "workspace");
  const snapshot =
    typeof item.agentConfigSnapshot === "object" && item.agentConfigSnapshot !== null
      ? (item.agentConfigSnapshot as Record<string, unknown>)
      : {};
  const operator =
    typeof item.currentOperator === "object" && item.currentOperator !== null
      ? (item.currentOperator as Record<string, unknown>)
      : undefined;
  const currentOperator =
    operator === undefined
      ? undefined
      : {
          operatorId: String(operator.operatorId),
          operatorEpoch: Number(operator.operatorEpoch),
        };
  return {
    id: String(item.id),
    name: String(item.name),
    kind: item.kind === "shared" ? "shared" : "personal",
    status:
      item.status === "draft" || item.status === "active" || item.status === "archived"
        ? item.status
        : "unknown",
    ...(item.goal === undefined ? {} : { goal: String(item.goal) }),
    ...(item.completionCriteria === undefined
      ? {}
      : { completionCriteria: String(item.completionCriteria) }),
    ...(item.runnerId === undefined ? {} : { runnerId: String(item.runnerId) }),
    ...(item.teamId === undefined || item.teamId === null ? {} : { teamId: String(item.teamId) }),
    ...(item.revision === undefined ? {} : { revision: Number(item.revision) }),
    ...((item.agentProfileId ?? snapshot.agentProfileId) === undefined
      ? {}
      : { agentProfileId: String(item.agentProfileId ?? snapshot.agentProfileId) }),
    ...(currentOperator === undefined ? {} : { currentOperator }),
  };
}

export function createCollaborationClient(
  options: CollaborationClientOptions = {},
): CollaborationClient {
  const baseUrl = normalizeRunnerBaseUrl(options.baseUrl ?? resolveRunnerApiUrl());
  const token = options.token ?? resolveRunnerToken();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const eventClient = createRunnerClient({
    baseUrl,
    ...(token === undefined ? {} : { token }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });

  async function request(
    path: string,
    init: { method?: string; payload?: unknown; revision?: number } = {},
  ): Promise<unknown> {
    const headers = new Headers({
      Accept: "application/json",
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    });
    let body: string | undefined;
    if (init.payload !== undefined) {
      const commandId = globalThis.crypto.randomUUID();
      headers.set("Content-Type", "application/json");
      headers.set("Idempotency-Key", commandId);
      body = JSON.stringify({
        schemaVersion: 1,
        commandId,
        payloadDigest: await digest(init.payload),
        ...init.payload,
      });
    }
    if (init.revision !== undefined) headers.set("If-Match", `"${init.revision}"`);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: body ?? null,
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
        typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      throw new RunnerApiError(
        typeof problem.detail === "string"
          ? problem.detail
          : `Runner request failed with HTTP ${response.status}.`,
        {
          ...(typeof problem.status === "number"
            ? { status: problem.status }
            : { status: response.status }),
          ...(typeof problem.code === "string" ? { code: problem.code } : {}),
          retryable: problem.retryable === true,
        },
      );
    }
    return parsed;
  }

  async function post(path: string, payload: unknown): Promise<unknown> {
    return request(path, { method: "POST", payload });
  }

  async function contextMutation(
    result: unknown,
  ): Promise<{ item: ContextItem; version: ContextVersion }> {
    return {
      item: entity(result, "contextItem") as unknown as ContextItem,
      version: entity(result, "contextVersion") as unknown as ContextVersion,
    };
  }

  return {
    baseUrl,
    async getWorkspace(workspaceId) {
      return workspace(await request(`/workspaces/${workspaceId}`));
    },
    async createSharedWorkspace(input: CreateSharedWorkspaceInput) {
      return workspace(await post("/workspaces", input));
    },
    async updateWorkspace(workspaceId, expectedRevision, input) {
      return workspace(
        await request(`/workspaces/${workspaceId}`, {
          method: "PATCH",
          payload: input,
          revision: expectedRevision,
        }),
      );
    },
    async listTeamMembers(teamId) {
      const result = record(await request(`/teams/${teamId}/members`), "team members");
      return (Array.isArray(result.members) ? result.members : []) as TeamMember[];
    },
    async inviteWorkspaceMembers(workspaceId, members) {
      const result = record(
        await post(`/workspaces/${workspaceId}/members`, { members }),
        "workspace members",
      );
      return (Array.isArray(result.memberships) ? result.memberships : []) as WorkspaceMember[];
    },
    async listContextItems(workspaceId) {
      const result = record(
        await request(`/workspaces/${workspaceId}/context-items`),
        "context items",
      );
      return (Array.isArray(result.contextItems) ? result.contextItems : []) as ContextItem[];
    },
    async createContextItem(workspaceId, input: ContextVersionInput) {
      return contextMutation(await post(`/workspaces/${workspaceId}/context-items`, input));
    },
    async appendContextVersion(
      workspaceId,
      contextItemId,
      expectedRevision,
      input: ContextVersionInput,
    ) {
      return contextMutation(
        await request(`/workspaces/${workspaceId}/context-items/${contextItemId}/versions`, {
          method: "POST",
          payload: input,
          revision: expectedRevision,
        }),
      );
    },
    async postDiscussion(workspaceId, body) {
      return entity(
        await post(`/workspaces/${workspaceId}/discussions`, { body }),
        "input",
      ) as unknown as CollaborationInput;
    },
    async postSuggestion(workspaceId, body) {
      return entity(
        await post(`/workspaces/${workspaceId}/suggestions`, { body }),
        "input",
      ) as unknown as CollaborationInput;
    },
    async decideSuggestion(workspaceId, suggestionId, decision, editedBody) {
      return entity(
        await post(`/workspaces/${workspaceId}/suggestions/${suggestionId}/decision`, {
          decision,
          ...(editedBody === undefined ? {} : { editedBody }),
        }),
        "suggestion",
      ) as unknown as CollaborationInput;
    },
    async postDirectInstruction(workspaceId, body) {
      return entity(
        await post(`/workspaces/${workspaceId}/direct-instructions`, { body }),
        "input",
      ) as unknown as CollaborationInput;
    },
    async createSharePreview(workspaceId, selectedRecordIds) {
      return entity(
        await post(`/personal-tasks/${workspaceId}/share-preview`, { selectedRecordIds }),
        "sharePreview",
      ) as unknown as SharePreview;
    },
    async convertPersonalTaskToShared(workspaceId, input) {
      const converted = await post(`/personal-tasks/${workspaceId}/share`, input);
      const id = String(entity(converted, "workspace").id);
      return this.getWorkspace(id);
    },
    subscribeWorkspaceEvents(workspaceId, afterSequence, handlers) {
      if (eventClient.subscribeWorkspaceEvents === undefined)
        throw new RunnerApiError("Runner event subscriptions are unavailable.");
      return eventClient.subscribeWorkspaceEvents(workspaceId, afterSequence, handlers);
    },
  };
}

export type {
  CollaborationClient,
  CollaborationInput,
  ContextItem,
  ContextVersion,
  ContextVersionInput,
  CreateSharedWorkspaceInput,
  SharePreview,
  TeamMember,
  WorkspaceMember,
  WorkspaceRole,
} from "./collaborationTypes";
