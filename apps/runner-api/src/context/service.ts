import { createHash } from "node:crypto";
import {
  CONTEXT_KINDS,
  type ContextItem,
  type ContextKind,
} from "../../../../packages/domain/src/context-item.js";
import {
  AGENT_EXPOSURES,
  type AgentExposure,
  type ContextVersionAttribution,
  canMemberReadContextVersion,
} from "../../../../packages/domain/src/context-version.js";
import type {
  SqliteDatabase,
  SqliteTransaction,
} from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";
import {
  assertCanContribute,
  assertCanEditContent,
  assertOperatorAuthority,
  assertWorkspaceWritable,
  loadWorkspaceAccess,
  resolveActorAttribution,
  type WorkspaceAccess,
  type WorkspacesService,
} from "../workspaces/service.js";

const MEMBER_VISIBILITY_VALUES = ["members", "private"] as const;
type MemberVisibility = (typeof MEMBER_VISIBILITY_VALUES)[number];

export interface ContextServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface ContextCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

export interface ContextVersionView {
  readonly id: string;
  readonly contextItemId: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly sourceRefs: string[];
  readonly memberVisibility: MemberVisibility;
  readonly agentExposure: AgentExposure;
  readonly attribution: ContextVersionAttribution;
  readonly supersedesId: string | null;
}

export interface ContextItemView {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ContextKind;
  readonly currentVersionId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly removedAt: string | null;
  readonly revision: number;
  readonly currentVersion: ContextVersionView;
  readonly versions: ContextVersionView[];
}

export interface ContextVersionInput {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly sourceRefs?: readonly string[] | undefined;
  readonly memberVisibility: string;
  readonly agentExposure: string;
  readonly payloadDigest: string;
}

export interface ContextMutationResult {
  readonly contextItem: ContextItemView;
  readonly contextVersion: ContextVersionView;
}

export interface RunSnapshotOptions {
  /**
   * Version ids the current operator explicitly approved in addition to the
   * automatic `provide_next_run` set.
   */
  readonly additionalVersionIds?: readonly string[] | undefined;
}

export interface RunSnapshotPlan {
  readonly contextVersionIds: string[];
  readonly contextVersions: ContextVersionView[];
  readonly rendered: string;
  readonly renderedDigest: string;
}

export interface TaskContextSnapshotView {
  readonly id: string;
  readonly runId: string;
  readonly contextVersionIds: string[];
  readonly renderedDigest: string;
  readonly createdAt: string;
}

export interface RunSnapshotResult {
  readonly snapshot: TaskContextSnapshotView;
  readonly plan: RunSnapshotPlan;
  readonly created: boolean;
}

interface ContextItemRow {
  id: string;
  workspaceId: string;
  kind: ContextKind;
  currentVersionId: string;
  createdBy: string;
  createdAt: string;
  removedAt: string | null;
}

interface ContextVersionRow {
  id: string;
  contextItemId: string;
  version: number;
  title: string;
  body: string;
  sourceRefs: string;
  memberVisibility: MemberVisibility;
  agentExposure: AgentExposure;
  attribution: string;
  supersedesId: string | null;
}

interface SnapshotRow {
  id: string;
  runId: string;
  contextVersionIds: string;
  renderedDigest: string;
  createdAt: string;
}

const JOINED_VERSION_SELECT = `
  SELECT v.id, context_item_id AS contextItemId, version, title, body, source_refs AS sourceRefs,
         member_visibility AS memberVisibility, agent_exposure AS agentExposure,
         attribution, supersedes_id AS supersedesId
    FROM context_version v
`;

const ITEM_SELECT = `
  SELECT id, workspace_id AS workspaceId, kind, current_version_id AS currentVersionId,
         created_by AS createdBy, created_at AS createdAt, removed_at AS removedAt
    FROM context_item
`;

const VERSION_SELECT = `
  SELECT id, context_item_id AS contextItemId, version, title, body, source_refs AS sourceRefs,
         member_visibility AS memberVisibility, agent_exposure AS agentExposure,
         attribution, supersedes_id AS supersedesId
    FROM context_version
`;

function requiredText(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} is required and must be within its length limit.`,
    });
  }
  return value;
}

function textValue(value: unknown, field: string, maxLength = 100_000): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} must be a string within its length limit.`,
    });
  }
  return value;
}

function requiredDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new ProblemError("invalid_request", {
      detail: "payloadDigest must be a SHA-256 digest.",
    });
  }
  return value;
}

function requiredRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProblemError("invalid_request", { detail: "If-Match must contain a revision." });
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new ProblemError("invalid_request", {
      detail: "sourceRefs must be an array of strings.",
    });
  }
  return [...value];
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // A malformed stored array is treated as empty rather than failing reads.
  }
  return [];
}

function parseAttribution(value: unknown): ContextVersionAttribution {
  let parsed: Record<string, unknown> = {};
  if (typeof value === "string") {
    try {
      const candidate: unknown = JSON.parse(value);
      if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }
  return {
    actorId: typeof parsed.actorId === "string" ? parsed.actorId : "unknown",
    displayNameAtTime:
      typeof parsed.displayNameAtTime === "string" ? parsed.displayNameAtTime : "Unknown Member",
    rolesAtTime: Array.isArray(parsed.rolesAtTime)
      ? parsed.rolesAtTime.filter((role): role is string => typeof role === "string")
      : [],
    occurredAt:
      typeof parsed.occurredAt === "string" ? parsed.occurredAt : new Date(0).toISOString(),
  };
}

function versionView(row: ContextVersionRow): ContextVersionView {
  return {
    id: String(row.id),
    contextItemId: String(row.contextItemId),
    version: Number(row.version),
    title: String(row.title),
    body: String(row.body),
    sourceRefs: parseStringArray(row.sourceRefs),
    memberVisibility: row.memberVisibility,
    agentExposure: row.agentExposure,
    attribution: parseAttribution(row.attribution),
    supersedesId: row.supersedesId === null ? null : String(row.supersedesId),
  };
}

function validateVersionInput(input: ContextVersionInput): {
  kind: ContextKind;
  title: string;
  body: string;
  sourceRefs: string[];
  memberVisibility: MemberVisibility;
  agentExposure: AgentExposure;
  payloadDigest: string;
} {
  if (!(CONTEXT_KINDS as readonly string[]).includes(input.kind)) {
    throw new ProblemError("invalid_request", { detail: "Unsupported context kind." });
  }
  if (!(MEMBER_VISIBILITY_VALUES as readonly string[]).includes(input.memberVisibility)) {
    throw new ProblemError("invalid_request", { detail: "Unsupported memberVisibility." });
  }
  if (!(AGENT_EXPOSURES as readonly string[]).includes(input.agentExposure)) {
    throw new ProblemError("invalid_request", { detail: "Unsupported agentExposure." });
  }
  return {
    kind: input.kind as ContextKind,
    title: requiredText(input.title, "title", 500),
    body: textValue(input.body, "body"),
    sourceRefs: stringArray(input.sourceRefs),
    memberVisibility: input.memberVisibility as MemberVisibility,
    agentExposure: input.agentExposure as AgentExposure,
    payloadDigest: requiredDigest(input.payloadDigest),
  };
}

function visibleTo(actorId: string, version: ContextVersionView): boolean {
  return canMemberReadContextVersion(
    {
      id: version.id,
      contextItemId: version.contextItemId,
      version: version.version,
      title: version.title,
      body: version.body,
      sourceRefs: version.sourceRefs,
      memberVisibility: version.memberVisibility,
      agentExposure: version.agentExposure,
      attribution: version.attribution,
      ...(version.supersedesId === null ? {} : { supersedesId: version.supersedesId }),
    },
    actorId,
  );
}

async function loadItemRow(
  executor: SqliteTransaction,
  workspaceId: string,
  contextItemId: string,
): Promise<ContextItemRow | null> {
  const rows = await executor.query<ContextItemRow>(
    `${ITEM_SELECT} WHERE workspace_id = ? AND id = ?`,
    [workspaceId, contextItemId],
  );
  return rows[0] ?? null;
}

async function loadVersions(
  executor: SqliteTransaction,
  contextItemId: string,
): Promise<ContextVersionView[]> {
  const rows = await executor.query<ContextVersionRow>(
    `${VERSION_SELECT} WHERE context_item_id = ? ORDER BY version ASC`,
    [contextItemId],
  );
  return rows.map(versionView);
}

function itemView(item: ContextItemRow, versions: readonly ContextVersionView[]): ContextItemView {
  const currentVersion = versions.find((version) => version.id === item.currentVersionId);
  if (currentVersion === undefined) throw new ProblemError("internal_error");
  return {
    id: String(item.id),
    workspaceId: String(item.workspaceId),
    kind: item.kind,
    currentVersionId: String(item.currentVersionId),
    createdBy: String(item.createdBy),
    createdAt: String(item.createdAt),
    removedAt: item.removedAt === null ? null : String(item.removedAt),
    revision: currentVersion.version,
    currentVersion,
    versions: [...versions],
  };
}

async function readVisibleItem(
  executor: SqliteTransaction,
  actorId: string,
  workspaceId: string,
  contextItemId: string,
): Promise<ContextItemView> {
  const item = await loadItemRow(executor, workspaceId, contextItemId);
  if (item === null) throw new ProblemError("not_found");
  const versions = await loadVersions(executor, contextItemId);
  const currentVersion = versions.find((version) => version.id === item.currentVersionId);
  if (currentVersion === undefined) throw new ProblemError("not_found");
  if (!visibleTo(actorId, currentVersion)) throw new ProblemError("not_found");
  return itemView(
    item,
    versions.filter((version) => visibleTo(actorId, version)),
  );
}

function assertCanExposeToAgent(access: WorkspaceAccess, exposure: AgentExposure): void {
  if (exposure === "provide_next_run") {
    assertOperatorAuthority(access);
  }
}

function assertMutableContextItem(item: ContextItem | ContextItemRow): void {
  if (item.removedAt !== undefined && item.removedAt !== null) {
    throw new ProblemError("invalid_request", {
      detail: "Removed context items cannot receive new versions.",
    });
  }
}

export class ContextService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: ContextServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async createContextItem(
    actorId: string,
    workspaceId: string,
    input: ContextVersionInput,
    commandId: string,
  ): Promise<ContextCommandResult<ContextMutationResult>> {
    const validated = validateVersionInput(input);
    const itemId = this.#newId();
    const versionId = this.#newId();
    const now = this.#now().toISOString();
    const response: {
      contextItem: ContextItemView | null;
      contextVersion: ContextVersionView | null;
    } = { contextItem: null, contextVersion: null };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest: validated.payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          assertWorkspaceWritable(access);
          assertCanContribute(access);
          assertCanExposeToAgent(access, validated.agentExposure);
          const attribution = await resolveActorAttribution(transaction, access, actorId, now);

          await transaction.execute(
            `INSERT INTO context_item
               (id, workspace_id, kind, current_version_id, created_by, created_at, removed_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`,
            [itemId, workspaceId, validated.kind, versionId, actorId, now],
          );
          await transaction.execute(
            `INSERT INTO context_version
               (id, context_item_id, version, title, body, source_refs, member_visibility,
                agent_exposure, attribution, supersedes_id)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              versionId,
              itemId,
              validated.title,
              validated.body,
              JSON.stringify(validated.sourceRefs),
              validated.memberVisibility,
              validated.agentExposure,
              JSON.stringify(attribution),
            ],
          );

          const item = await readVisibleItem(transaction, actorId, workspaceId, itemId);
          const version = item.versions.find((entry) => entry.id === versionId);
          if (version === undefined) throw new ProblemError("internal_error");
          response.contextItem = item;
          response.contextVersion = version;
        },
        events: [
          {
            type: "context.item_created",
            schemaVersion: 1,
            occurredAt: now,
            visibility:
              validated.memberVisibility === "private"
                ? { kind: "private", actorIds: [actorId] }
                : { kind: "workspace_members" },
            payloadDigest: validated.payloadDigest,
            payload: { contextItemId: itemId, contextVersionId: versionId, kind: validated.kind },
          },
        ],
      });
      if (result.response.contextItem === null || result.response.contextVersion === null) {
        throw new ProblemError("internal_error");
      }
      return {
        response: {
          contextItem: result.response.contextItem,
          contextVersion: result.response.contextVersion,
        },
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async appendContextVersion(
    actorId: string,
    workspaceId: string,
    contextItemId: string,
    expectedRevision: number | undefined,
    input: ContextVersionInput,
    commandId: string,
  ): Promise<ContextCommandResult<ContextMutationResult>> {
    const validated = validateVersionInput(input);
    const revision = requiredRevision(expectedRevision);
    const now = this.#now().toISOString();
    const nextVersionId = this.#newId();
    const response: {
      contextItem: ContextItemView | null;
      contextVersion: ContextVersionView | null;
    } = { contextItem: null, contextVersion: null };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest: validated.payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          assertWorkspaceWritable(access);
          const item = await loadItemRow(transaction, workspaceId, contextItemId);
          if (item === null) throw new ProblemError("not_found");
          assertMutableContextItem(item);
          assertCanEditContent(access, item.createdBy);
          if (item.kind !== validated.kind) {
            throw new ProblemError("invalid_request", {
              detail: "A context version cannot change the item kind.",
            });
          }
          assertCanExposeToAgent(access, validated.agentExposure);

          const versions = await loadVersions(transaction, contextItemId);
          const current = versions.find((version) => version.id === item.currentVersionId);
          if (current === undefined) throw new ProblemError("not_found");
          if (current.version !== revision) {
            throw new ProblemError("revision_conflict", { revision: current.version });
          }

          const attribution = await resolveActorAttribution(transaction, access, actorId, now);
          await transaction.execute(
            `INSERT INTO context_version
               (id, context_item_id, version, title, body, source_refs, member_visibility,
                agent_exposure, attribution, supersedes_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              nextVersionId,
              contextItemId,
              current.version + 1,
              validated.title,
              validated.body,
              JSON.stringify(validated.sourceRefs),
              validated.memberVisibility,
              validated.agentExposure,
              JSON.stringify(attribution),
              current.id,
            ],
          );
          await transaction.execute("UPDATE context_item SET current_version_id = ? WHERE id = ?", [
            nextVersionId,
            contextItemId,
          ]);

          const updated = await readVisibleItem(transaction, actorId, workspaceId, contextItemId);
          const nextVersion = updated.versions.find((entry) => entry.id === nextVersionId);
          if (nextVersion === undefined) throw new ProblemError("internal_error");
          response.contextItem = updated;
          response.contextVersion = nextVersion;
        },
        events: [
          {
            type: "context.version_appended",
            schemaVersion: 1,
            occurredAt: now,
            visibility:
              validated.memberVisibility === "private"
                ? { kind: "private", actorIds: [actorId] }
                : { kind: "workspace_members" },
            payloadDigest: validated.payloadDigest,
            payload: {
              contextItemId,
              contextVersionId: nextVersionId,
              version: revision + 1,
            },
          },
        ],
      });
      if (result.response.contextItem === null || result.response.contextVersion === null) {
        throw new ProblemError("internal_error");
      }
      return {
        response: {
          contextItem: result.response.contextItem,
          contextVersion: result.response.contextVersion,
        },
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async listContextItems(
    actorId: string,
    workspaceId: string,
  ): Promise<{ contextItems: ContextItemView[] }> {
    await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    const rows = await this.#database.query<ContextItemRow>(
      `${ITEM_SELECT} WHERE workspace_id = ? AND removed_at IS NULL ORDER BY created_at DESC`,
      [workspaceId],
    );
    const contextItems: ContextItemView[] = [];
    for (const row of rows) {
      const versions = await loadVersions(this.#database, row.id);
      const current = versions.find((version) => version.id === row.currentVersionId);
      if (current === undefined || !visibleTo(actorId, current)) continue;
      contextItems.push(
        itemView(
          row,
          versions.filter((version) => visibleTo(actorId, version)),
        ),
      );
    }
    return { contextItems };
  }

  async getContextItem(
    actorId: string,
    workspaceId: string,
    contextItemId: string,
  ): Promise<{ contextItem: ContextItemView }> {
    await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    return {
      contextItem: await readVisibleItem(this.#database, actorId, workspaceId, contextItemId),
    };
  }

  /**
   * Returns the current versions that a Run may receive: explicit
   * `provide_next_run` exposure plus any additional versions the operator
   * selected for this Run.
   */
  async resolveRunSnapshot(
    workspaceId: string,
    options: RunSnapshotOptions = {},
  ): Promise<RunSnapshotPlan> {
    const rows = await this.#database.query<ContextVersionRow>(
      `${JOINED_VERSION_SELECT}
        JOIN context_item i ON i.current_version_id = v.id
       WHERE i.workspace_id = ? AND i.removed_at IS NULL AND v.agent_exposure = 'provide_next_run'
       ORDER BY i.created_at ASC, v.id ASC`,
      [workspaceId],
    );
    const versions = rows.map(versionView);
    const seen = new Set(versions.map((version) => version.id));

    const additional = [...new Set(options.additionalVersionIds ?? [])];
    if (additional.length > 0) {
      const placeholders = additional.map(() => "?").join(", ");
      const selectedRows = await this.#database.query<ContextVersionRow>(
        `${JOINED_VERSION_SELECT}
          JOIN context_item i ON i.id = v.context_item_id
         WHERE v.id IN (${placeholders}) AND i.workspace_id = ?
         ORDER BY i.created_at ASC, v.version ASC`,
        [...additional, workspaceId],
      );
      if (selectedRows.length !== additional.length) {
        throw new ProblemError("invalid_request", {
          detail: "Every selected context version must belong to the workspace.",
        });
      }
      for (const selected of selectedRows.map(versionView)) {
        if (!seen.has(selected.id)) {
          seen.add(selected.id);
          versions.push(selected);
        }
      }
    }

    const rendered = versions
      .map((version) => `# ${version.title}\n\n${version.body}`)
      .join("\n\n---\n\n");
    const renderedDigest = `sha256:${createHash("sha256").update(rendered, "utf8").digest("hex")}`;
    return {
      contextVersionIds: versions.map((version) => version.id),
      contextVersions: versions,
      rendered,
      renderedDigest,
    };
  }

  /**
   * Persists the immutable Run snapshot inside the caller's transaction. This
   * allows the Run command to create the snapshot atomically with the Run row.
   */
  async createRunSnapshotInTransaction(
    transaction: SqliteTransaction,
    runId: string,
    workspaceId: string,
    options: RunSnapshotOptions = {},
  ): Promise<RunSnapshotResult> {
    const run = requiredText(runId, "runId", 200);
    const existingRows = await transaction.query<SnapshotRow>(
      `SELECT id, run_id AS runId, context_version_ids AS contextVersionIds,
              rendered_digest AS renderedDigest, created_at AS createdAt
         FROM task_context_snapshot
        WHERE run_id = ?`,
      [run],
    );
    const existing = existingRows[0];
    if (existing !== undefined) {
      const snapshot = snapshotView(existing);
      const versions = await this.loadVersionsByIds(transaction, snapshot.contextVersionIds);
      return {
        snapshot,
        plan: {
          contextVersionIds: snapshot.contextVersionIds,
          contextVersions: versions,
          rendered: "",
          renderedDigest: snapshot.renderedDigest,
        },
        created: false,
      };
    }

    const now = this.#now().toISOString();
    const plan = await this.resolveRunSnapshotIn(transaction, workspaceId, options);
    const snapshot: TaskContextSnapshotView = {
      id: this.#newId(),
      runId: run,
      contextVersionIds: plan.contextVersionIds,
      renderedDigest: plan.renderedDigest,
      createdAt: now,
    };
    await transaction.execute(
      `INSERT INTO task_context_snapshot
         (id, run_id, context_version_ids, rendered_digest, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.runId,
        JSON.stringify(snapshot.contextVersionIds),
        snapshot.renderedDigest,
        snapshot.createdAt,
      ],
    );
    return { snapshot, plan, created: true };
  }

  async createRunSnapshot(
    runId: string,
    workspaceId: string,
    options: RunSnapshotOptions = {},
  ): Promise<RunSnapshotResult> {
    return this.#database.write((transaction) =>
      this.createRunSnapshotInTransaction(transaction, runId, workspaceId, options),
    );
  }

  async getRunSnapshot(
    actorId: string,
    workspaceId: string,
    runId: string,
  ): Promise<{ snapshot: TaskContextSnapshotView; contextVersions: ContextVersionView[] }> {
    await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    const rows = await this.#database.query<SnapshotRow>(
      `SELECT s.id, s.run_id AS runId, s.context_version_ids AS contextVersionIds,
              s.rendered_digest AS renderedDigest, s.created_at AS createdAt
         FROM task_context_snapshot s
         JOIN run r ON r.id = s.run_id
        WHERE s.run_id = ? AND r.workspace_id = ?`,
      [runId, workspaceId],
    );
    const row = rows[0];
    if (row === undefined) throw new ProblemError("not_found");
    const snapshot = snapshotView(row);
    const versions = await this.loadVersionsByIds(this.#database, snapshot.contextVersionIds);
    return {
      snapshot,
      contextVersions: versions.filter((version) => visibleTo(actorId, version)),
    };
  }

  async listAgentExposedVersions(workspaceId: string): Promise<ContextVersionView[]> {
    return (await this.resolveRunSnapshot(workspaceId)).contextVersions;
  }

  private async resolveRunSnapshotIn(
    executor: SqliteTransaction,
    workspaceId: string,
    options: RunSnapshotOptions,
  ): Promise<RunSnapshotPlan> {
    const rows = await executor.query<ContextVersionRow>(
      `${JOINED_VERSION_SELECT}
        JOIN context_item i ON i.current_version_id = v.id
       WHERE i.workspace_id = ? AND i.removed_at IS NULL AND v.agent_exposure = 'provide_next_run'
       ORDER BY i.created_at ASC, v.id ASC`,
      [workspaceId],
    );
    const versions = rows.map(versionView);
    const seen = new Set(versions.map((version) => version.id));
    const additional = [...new Set(options.additionalVersionIds ?? [])];
    if (additional.length > 0) {
      const placeholders = additional.map(() => "?").join(", ");
      const selectedRows = await executor.query<ContextVersionRow>(
        `${JOINED_VERSION_SELECT}
          JOIN context_item i ON i.id = v.context_item_id
         WHERE v.id IN (${placeholders}) AND i.workspace_id = ?
         ORDER BY i.created_at ASC, v.version ASC`,
        [...additional, workspaceId],
      );
      if (selectedRows.length !== additional.length) {
        throw new ProblemError("invalid_request", {
          detail: "Every selected context version must belong to the workspace.",
        });
      }
      for (const selected of selectedRows.map(versionView)) {
        if (!seen.has(selected.id)) {
          seen.add(selected.id);
          versions.push(selected);
        }
      }
    }
    const rendered = versions
      .map((version) => `# ${version.title}\n\n${version.body}`)
      .join("\n\n---\n\n");
    const renderedDigest = `sha256:${createHash("sha256").update(rendered, "utf8").digest("hex")}`;
    return {
      contextVersionIds: versions.map((version) => version.id),
      contextVersions: versions,
      rendered,
      renderedDigest,
    };
  }

  private async loadVersionsByIds(
    executor: SqliteTransaction,
    ids: readonly string[],
  ): Promise<ContextVersionView[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await executor.query<ContextVersionRow>(
      `${VERSION_SELECT} WHERE id IN (${placeholders})`,
      [...ids],
    );
    const byId = new Map(rows.map((row) => [String(row.id), versionView(row)]));
    return ids
      .map((id) => byId.get(id))
      .filter((version): version is ContextVersionView => version !== undefined);
  }
}

function snapshotView(row: SnapshotRow): TaskContextSnapshotView {
  return {
    id: String(row.id),
    runId: String(row.runId),
    contextVersionIds: parseStringArray(row.contextVersionIds),
    renderedDigest: String(row.renderedDigest),
    createdAt: String(row.createdAt),
  };
}

export function createContextService(options: ContextServiceOptions): ContextService {
  return new ContextService(options);
}

export type { WorkspacesService };
