import type {
  FederationMode,
  WorkspaceStatus,
  WorkspaceVisibility,
} from "../../../../packages/domain/src/workspace.js";
import type { WorkspaceMemberRole } from "../../../../packages/domain/src/workspace-member.js";
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

export const WORKSPACE_ROLES = ["owner", "operator", "contributor", "observer"] as const;
export type WorkspaceRole = WorkspaceMemberRole;

export const ACTIVE_RUN_STATES = [
  "created",
  "running",
  "waiting_approval",
  "stopping",
  "needs_confirmation",
] as const;

export interface WorkspacesServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface WorkspaceCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

export interface CurrentOperatorView {
  readonly operatorId: string;
  readonly operatorEpoch: number;
}

export interface SharedWorkspaceView {
  readonly id: string;
  readonly kind: "personal" | "shared";
  readonly teamId: string | null;
  readonly ownerId: string;
  readonly runnerId: string;
  readonly name: string;
  readonly goal: string;
  readonly completionCriteria: string;
  readonly status: WorkspaceStatus;
  readonly visibility: WorkspaceVisibility;
  readonly agentConfigSnapshot: Record<string, unknown>;
  readonly federationMode: FederationMode;
  readonly revision: number;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly currentOperator: CurrentOperatorView;
  readonly activeRunId: string | null;
}

export interface WorkspaceMemberView {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly canApprove: boolean;
  readonly canReview: boolean;
  readonly joinedAt: string;
  readonly leftAt: string | null;
}

export interface WorkspaceAccess {
  readonly workspace: SharedWorkspaceView;
  readonly membership: WorkspaceMemberView | null;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly canApprove: boolean;
  readonly canReview: boolean;
  readonly currentOperator: CurrentOperatorView;
  readonly activeRunId: string | null;
}

export interface ActorAttributionSnapshot {
  readonly actorId: string;
  readonly displayNameAtTime: string;
  readonly rolesAtTime: readonly string[];
  readonly occurredAt: string;
}

export interface CreateSharedWorkspaceInput {
  readonly name: string;
  readonly goal?: string | undefined;
  readonly completionCriteria?: string | undefined;
  readonly teamId: string;
  readonly runnerId: string;
  readonly agentProfileId?: string | undefined;
  readonly federationMode?: FederationMode | undefined;
  readonly payloadDigest: string;
}

export interface UpdateWorkspaceInput {
  readonly name?: string | undefined;
  readonly goal?: string | undefined;
  readonly completionCriteria?: string | undefined;
  readonly runnerId?: string | undefined;
  readonly agentProfileId?: string | undefined;
  readonly payloadDigest: string;
}

export interface ArchiveWorkspaceInput {
  readonly payloadDigest: string;
}

export interface ActivateWorkspaceInput {
  readonly payloadDigest: string;
}

export interface WorkspaceMemberInvitation {
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly canApprove?: boolean | undefined;
  readonly canReview?: boolean | undefined;
}

export interface InviteWorkspaceMembersInput {
  readonly members: readonly WorkspaceMemberInvitation[];
  readonly payloadDigest: string;
}

export interface InviteWorkspaceMembersResult {
  readonly membership: WorkspaceMemberView | null;
  readonly memberships: WorkspaceMemberView[];
}

export interface WorkspaceCommandEnvelope {
  readonly workspace: SharedWorkspaceView;
}

interface WorkspaceRow {
  id: string;
  kind: string;
  teamId: string | null;
  ownerId: string;
  runnerId: string;
  name: string;
  goal: string;
  completionCriteria: string;
  status: WorkspaceStatus;
  visibility: WorkspaceVisibility;
  agentConfigSnapshot: string;
  federationMode: FederationMode;
  revision: number;
  createdAt: string;
  archivedAt: string | null;
  operatorId: string;
  operatorEpoch: number;
  activeRunId: string | null;
}

interface MemberRow {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  canApprove: number;
  canReview: number;
  joinedAt: string;
  leftAt: string | null;
}

const WORKSPACE_SELECT = `
  SELECT w.id, w.kind, w.team_id AS teamId, w.owner_id AS ownerId, w.runner_id AS runnerId,
         w.name, w.goal, w.completion_criteria AS completionCriteria, w.status, w.visibility,
         w.agent_config_snapshot AS agentConfigSnapshot, w.federation_mode AS federationMode,
         w.revision, w.created_at AS createdAt, w.archived_at AS archivedAt,
         c.operator_id AS operatorId, c.operator_epoch AS operatorEpoch,
         c.active_run_id AS activeRunId
  FROM workspace w
  JOIN workspace_control c ON c.workspace_id = w.id
`;

const ACTIVE_RUN_SQL = `(${ACTIVE_RUN_STATES.map((state) => `'${state}'`).join(", ")})`;

function requiredText(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} is required and must be within its length limit.`,
    });
  }
  return value;
}

function optionalText(value: unknown, field: string, maxLength = 10_000): string | undefined {
  if (value === undefined) return undefined;
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

function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

function parseAgentConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt legacy snapshots are surfaced as an empty object, never as a crash.
  }
  return {};
}

function workspaceView(
  row: WorkspaceRow,
  activeRunId: string | null = row.activeRunId,
): SharedWorkspaceView {
  return {
    id: String(row.id),
    kind: row.kind === "personal" ? "personal" : "shared",
    teamId: row.teamId === null ? null : String(row.teamId),
    ownerId: String(row.ownerId),
    runnerId: String(row.runnerId),
    name: String(row.name),
    goal: String(row.goal),
    completionCriteria: String(row.completionCriteria),
    status: row.status,
    visibility: row.visibility,
    agentConfigSnapshot: parseAgentConfig(row.agentConfigSnapshot),
    federationMode: row.federationMode,
    revision: Number(row.revision),
    createdAt: String(row.createdAt),
    archivedAt: row.archivedAt === null ? null : String(row.archivedAt),
    currentOperator: {
      operatorId: String(row.operatorId),
      operatorEpoch: Number(row.operatorEpoch),
    },
    activeRunId: activeRunId === null ? null : String(activeRunId),
  };
}

function memberView(row: MemberRow): WorkspaceMemberView {
  return {
    workspaceId: String(row.workspaceId),
    userId: String(row.userId),
    role: row.role,
    canApprove: Number(row.canApprove) === 1,
    canReview: Number(row.canReview) === 1,
    joinedAt: String(row.joinedAt),
    leftAt: row.leftAt === null ? null : String(row.leftAt),
  };
}

/**
 * Requires If-Match to be an explicit numeric revision. Both the contract form
 * (`"3"`) and an unwrapped integer (`3`) are accepted so route code can pass the
 * raw header without losing the validation error.
 */
export function parseIfMatchRevision(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    throw new ProblemError("invalid_request", { detail: "If-Match is required." });
  }
  const match = /^"?([0-9]+)"?$/.exec(raw.trim());
  if (match === null) {
    throw new ProblemError("invalid_request", {
      detail: "If-Match must contain a workspace or context revision.",
    });
  }
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new ProblemError("invalid_request", { detail: "If-Match contains an invalid revision." });
  }
  return revision;
}

export function assertWorkspaceWritable(access: WorkspaceAccess): void {
  if (access.workspace.status === "archived") {
    throw new ProblemError("workspace_archived");
  }
}

export function assertWorkspaceRole(
  access: WorkspaceAccess,
  roles: readonly WorkspaceRole[],
): void {
  if (!roles.includes(access.role)) {
    throw new ProblemError("permission_denied");
  }
}

/**
 * Owners, operators and contributors may create collaboration content.
 * Observers stay read-only.
 */
export function assertCanContribute(access: WorkspaceAccess): void {
  assertWorkspaceRole(access, ["owner", "operator", "contributor"]);
}

/**
 * Operators and owners are the only roles allowed to directly instruct the
 * Agent, decide a suggestion, or approve `provide_next_run` exposure.
 */
export function assertOperatorAuthority(access: WorkspaceAccess): void {
  assertWorkspaceRole(access, ["owner", "operator"]);
}

/**
 * A contributor may edit only content they created. Owners and operators may
 * edit any workspace content. Observers cannot edit.
 */
export function assertCanEditContent(access: WorkspaceAccess, authorId: string): void {
  assertWorkspaceRole(access, ["owner", "operator", "contributor"]);
  if (access.role === "contributor" && authorId !== access.userId) {
    throw new ProblemError("permission_denied");
  }
}

export async function ensureUserRow(
  executor: SqliteTransaction,
  userId: string,
  displayName: string,
  occurredAt: string,
): Promise<void> {
  await executor.execute(
    "INSERT OR IGNORE INTO user (id, display_name, status, auth_version, created_at) VALUES (?, ?, 'active', 1, ?)",
    [userId, displayName, occurredAt],
  );
}

export async function resolveActorAttribution(
  executor: SqliteTransaction,
  access: WorkspaceAccess,
  actorId: string,
  occurredAt: string,
): Promise<ActorAttributionSnapshot> {
  const rows = await executor.query<{ displayName: string }>(
    "SELECT display_name AS displayName FROM user WHERE id = ?",
    [actorId],
  );
  const displayName =
    rows[0]?.displayName ?? (access.role === "owner" ? "Workspace Owner" : "Workspace Member");
  if (rows[0] === undefined) {
    await ensureUserRow(executor, actorId, displayName, occurredAt);
  }
  return {
    actorId,
    displayNameAtTime: displayName,
    rolesAtTime: [access.role],
    occurredAt,
  };
}

export async function loadWorkspaceAccess(
  executor: SqliteTransaction,
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const rows = await executor.query<WorkspaceRow>(`${WORKSPACE_SELECT} WHERE w.id = ?`, [
    workspaceId,
  ]);
  const row = rows[0];
  if (row === undefined) throw new ProblemError("not_found");
  if (row.teamId !== null) {
    const teamMemberships = await executor.query<{ status: string; expiresAt: string | null }>(
      "SELECT status, expires_at AS expiresAt FROM membership WHERE team_id = ? AND user_id = ?",
      [row.teamId, actorId],
    );
    const teamMembership = teamMemberships[0];
    if (
      teamMembership === undefined ||
      teamMembership.status !== "active" ||
      (teamMembership.expiresAt !== null && Date.parse(teamMembership.expiresAt) <= Date.now())
    ) {
      throw new ProblemError("permission_denied");
    }
  }

  const memberRows = await executor.query<MemberRow>(
    `SELECT workspace_id AS workspaceId, user_id AS userId, role,
            can_approve AS canApprove, can_review AS canReview,
            joined_at AS joinedAt, left_at AS leftAt
       FROM workspace_member
      WHERE workspace_id = ? AND user_id = ? AND left_at IS NULL`,
    [workspaceId, actorId],
  );
  const membership = memberRows[0] === undefined ? null : memberView(memberRows[0]);
  const isOwner = row.ownerId === actorId || membership?.role === "owner";
  if (!isOwner && membership === null) throw new ProblemError("not_found");

  const activeRows = await executor.query<{ id: string }>(
    `SELECT id FROM run WHERE workspace_id = ? AND state IN ${ACTIVE_RUN_SQL} LIMIT 1`,
    [workspaceId],
  );
  const activeRunId = activeRows[0]?.id ?? null;
  const role: WorkspaceRole = isOwner ? "owner" : (membership?.role ?? "observer");
  const currentOperator = {
    operatorId: String(row.operatorId),
    operatorEpoch: Number(row.operatorEpoch),
  };

  return {
    workspace: workspaceView(row, activeRunId),
    membership,
    userId: actorId,
    role,
    canApprove: role === "owner" || membership?.canApprove === true,
    canReview: role === "owner" || membership?.canReview === true,
    currentOperator,
    activeRunId,
  };
}

function assertStartable(access: WorkspaceAccess): void {
  const workspace = access.workspace;
  if (workspace.status === "archived") throw new ProblemError("workspace_archived");
  if (workspace.goal.trim().length === 0 || workspace.completionCriteria.trim().length === 0) {
    throw new ProblemError("invalid_request", {
      detail: "A Run requires a goal and completion criteria.",
    });
  }
}

async function assertOperatorAndApprover(
  executor: SqliteTransaction,
  workspaceId: string,
): Promise<void> {
  const operators = await executor.query<{ userId: string }>(
    `SELECT user_id AS userId
       FROM workspace_member
      WHERE workspace_id = ? AND role = 'operator' AND left_at IS NULL
      LIMIT 1`,
    [workspaceId],
  );
  if (operators.length === 0) {
    throw new ProblemError("invalid_request", {
      detail: "A Run requires an assigned operator.",
    });
  }

  const approvers = await executor.query<{ userId: string }>(
    `SELECT user_id AS userId
       FROM workspace_member
      WHERE workspace_id = ? AND can_approve = 1 AND left_at IS NULL
      LIMIT 1`,
    [workspaceId],
  );
  if (approvers.length === 0) {
    throw new ProblemError("invalid_request", {
      detail: "A Run requires an assigned approver.",
    });
  }
}

export class WorkspacesService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: WorkspacesServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async createSharedWorkspace(
    actorId: string,
    input: CreateSharedWorkspaceInput,
    commandId: string,
  ): Promise<WorkspaceCommandResult<WorkspaceCommandEnvelope>> {
    const name = requiredText(input.name, "name", 50).trim();
    const goal = optionalText(input.goal, "goal") ?? "";
    const completionCriteria = optionalText(input.completionCriteria, "completionCriteria") ?? "";
    const teamId = requiredText(input.teamId, "teamId", 200);
    const runnerId = requiredText(input.runnerId, "runnerId", 200);
    const agentProfileId = optionalText(input.agentProfileId, "agentProfileId", 200);
    const federationMode = input.federationMode ?? "disabled";
    if (
      !["disabled", "snapshot", "snapshot_tools", "snapshot_tools_patch"].includes(federationMode)
    ) {
      throw new ProblemError("invalid_request", { detail: "Unsupported federationMode." });
    }
    const payloadDigest = requiredDigest(input.payloadDigest);

    const teams = await this.#database.query<{ id: string }>("SELECT id FROM team WHERE id = ?", [
      teamId,
    ]);
    if (teams.length === 0) {
      throw new ProblemError("invalid_request", {
        detail: "teamId must reference an existing team.",
      });
    }

    const id = this.#newId();
    const now = this.#now().toISOString();
    const agentConfigSnapshot: Record<string, unknown> = {
      provider: "faux",
      model: "faux-model",
      pinned: false,
      ...(agentProfileId === undefined ? {} : { agentProfileId }),
    };
    const workspace: SharedWorkspaceView = {
      id,
      kind: "shared",
      teamId,
      ownerId: actorId,
      runnerId,
      name,
      goal,
      completionCriteria,
      status: "draft",
      visibility: "invited_members",
      agentConfigSnapshot,
      federationMode,
      revision: 1,
      createdAt: now,
      archivedAt: null,
      currentOperator: { operatorId: actorId, operatorEpoch: 1 },
      activeRunId: null,
    };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId: id,
        commandId,
        payloadDigest,
        response: { workspace },
        mutate: async (transaction) => {
          await ensureUserRow(transaction, actorId, "Workspace Owner", now);
          await transaction.execute(
            `INSERT OR IGNORE INTO runner
               (id, team_id, name, purpose, status, version, capabilities, policy_revision, last_heartbeat_at)
             VALUES (?, ?, 'Shared Runner', 'shared', 'available', '0.1.0', '[]', 0, ?)`,
            [runnerId, teamId, now],
          );
          if (agentProfileId !== undefined) {
            await transaction.execute(
              `INSERT OR IGNORE INTO model_profile
                 (id, runner_id, provider, model, reasoning_options, secret_ref, enabled)
               VALUES (?, ?, 'faux', 'faux-model', '{}', 'faux://not-applicable', 1)`,
              [agentProfileId, runnerId],
            );
          }
          await transaction.execute(
            `INSERT INTO workspace
               (id, kind, team_id, owner_id, runner_id, name, goal, completion_criteria,
                status, visibility, agent_config_snapshot, federation_mode, revision, created_at, archived_at)
             VALUES (?, 'shared', ?, ?, ?, ?, ?, ?, 'draft', 'invited_members', ?, ?, 1, ?, NULL)`,
            [
              id,
              teamId,
              actorId,
              runnerId,
              name,
              goal,
              completionCriteria,
              JSON.stringify(agentConfigSnapshot),
              federationMode,
              now,
            ],
          );
          await transaction.execute(
            `INSERT INTO workspace_control
               (workspace_id, operator_id, operator_epoch, active_run_id, active_run_epoch, revision, updated_at)
             VALUES (?, ?, 1, NULL, 0, 1, ?)`,
            [id, actorId, now],
          );
          await transaction.execute(
            `INSERT INTO workspace_member
               (workspace_id, user_id, role, can_approve, can_review, joined_at, left_at)
             VALUES (?, ?, 'owner', 1, 1, ?, NULL)`,
            [id, actorId, now],
          );
        },
        events: [
          {
            type: "workspace.created",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { workspaceId: id, name, status: "draft" },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async listWorkspaces(actorId: string): Promise<{ workspaces: SharedWorkspaceView[] }> {
    const rows = await this.#database.query<WorkspaceRow>(
      `${WORKSPACE_SELECT}
        WHERE w.kind = 'shared'
          AND (w.owner_id = ? OR EXISTS (
            SELECT 1 FROM workspace_member m
             WHERE m.workspace_id = w.id AND m.user_id = ? AND m.left_at IS NULL
          ))
        ORDER BY w.created_at DESC`,
      [actorId, actorId],
    );
    return { workspaces: rows.map((row) => workspaceView(row)) };
  }

  async getWorkspace(actorId: string, workspaceId: string): Promise<WorkspaceCommandEnvelope> {
    const access = await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    return { workspace: access.workspace };
  }

  async updateWorkspace(
    actorId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
    expectedRevision: number | undefined,
    commandId: string,
  ): Promise<WorkspaceCommandResult<WorkspaceCommandEnvelope>> {
    const revision = requiredRevision(expectedRevision);
    const payloadDigest = requiredDigest(input.payloadDigest);
    const response: { workspace: SharedWorkspaceView | null } = { workspace: null };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          assertWorkspaceWritable(access);
          assertOperatorAuthority(access);
          const current = access.workspace;
          if (input.runnerId !== undefined && input.runnerId !== current.runnerId) {
            throw new ProblemError("invalid_request", {
              detail: "runnerId cannot be changed after workspace creation.",
            });
          }
          const name =
            input.name === undefined ? current.name : requiredText(input.name, "name", 50).trim();
          const goal =
            input.goal === undefined ? current.goal : (optionalText(input.goal, "goal") ?? "");
          const completionCriteria =
            input.completionCriteria === undefined
              ? current.completionCriteria
              : (optionalText(input.completionCriteria, "completionCriteria") ?? "");
          const agentConfigSnapshot =
            input.agentProfileId === undefined
              ? current.agentConfigSnapshot
              : { ...current.agentConfigSnapshot, agentProfileId: input.agentProfileId };

          const changed =
            name !== current.name ||
            goal !== current.goal ||
            completionCriteria !== current.completionCriteria ||
            input.agentProfileId !== undefined;

          if (
            access.activeRunId !== null &&
            (input.runnerId !== undefined || input.agentProfileId !== undefined)
          ) {
            throw new ProblemError("invalid_request", {
              detail: "Workspace configuration is locked while a Run is active.",
            });
          }
          if (access.workspace.revision !== revision) {
            throw new ProblemError("revision_conflict", { revision: access.workspace.revision });
          }
          if (
            access.workspace.status === "active" &&
            (goal.trim().length === 0 || completionCriteria.trim().length === 0)
          ) {
            throw new ProblemError("invalid_request", {
              detail: "An active workspace requires a goal and completion criteria.",
            });
          }
          if (!changed) {
            response.workspace = current;
            return;
          }

          const now = this.#now().toISOString();
          await transaction.execute(
            `UPDATE workspace
                SET name = ?, goal = ?, completion_criteria = ?, agent_config_snapshot = ?,
                    revision = revision + 1
              WHERE id = ?`,
            [name, goal, completionCriteria, JSON.stringify(agentConfigSnapshot), workspaceId],
          );
          await transaction.execute(
            "UPDATE workspace_control SET revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
            [now, workspaceId],
          );
          response.workspace = {
            ...current,
            name,
            goal,
            completionCriteria,
            agentConfigSnapshot,
            revision: current.revision + 1,
          };
          await transaction.execute(
            "INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, 'workspace.updated', ?, NULL, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              workspaceId,
              workspaceId,
              actorId,
              now,
              JSON.stringify({ kind: "workspace_members" }),
              `workspace:${workspaceId}`,
              payloadDigest,
              JSON.stringify({ workspaceId, revision: current.revision + 1 }),
            ],
          );
          await transaction.execute(
            "INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, 'handoff.background_changed', ?, NULL, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              workspaceId,
              workspaceId,
              actorId,
              now,
              JSON.stringify({ kind: "workspace_members" }),
              `workspace:${workspaceId}`,
              payloadDigest,
              JSON.stringify({ workspaceId, revision: current.revision + 1, goal }),
            ],
          );
        },
      });
      if (result.response.workspace === null) throw new ProblemError("internal_error");
      return { response: { workspace: result.response.workspace }, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async archiveWorkspace(
    actorId: string,
    workspaceId: string,
    input: ArchiveWorkspaceInput,
    expectedRevision: number | undefined,
    commandId: string,
  ): Promise<WorkspaceCommandResult<WorkspaceCommandEnvelope>> {
    const revision = requiredRevision(expectedRevision);
    const payloadDigest = requiredDigest(input.payloadDigest);
    const response: { workspace: SharedWorkspaceView | null } = { workspace: null };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          assertWorkspaceRole(access, ["owner"]);
          if (access.workspace.status === "archived") {
            throw new ProblemError("workspace_archived");
          }
          if (access.workspace.revision !== revision) {
            throw new ProblemError("revision_conflict", { revision: access.workspace.revision });
          }
          if (access.activeRunId !== null) {
            throw new ProblemError("task_active", {
              detail: "An active Run must stop before the workspace is archived.",
            });
          }

          const now = this.#now().toISOString();
          await transaction.execute(
            "UPDATE workspace SET status = 'archived', archived_at = ?, revision = revision + 1 WHERE id = ?",
            [now, workspaceId],
          );
          await transaction.execute(
            "UPDATE workspace_control SET revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
            [now, workspaceId],
          );
          response.workspace = {
            ...access.workspace,
            status: "archived",
            archivedAt: now,
            revision: access.workspace.revision + 1,
          };
          await transaction.execute(
            "INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, 'workspace.archived', ?, NULL, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              workspaceId,
              workspaceId,
              actorId,
              now,
              JSON.stringify({ kind: "workspace_members" }),
              `workspace:${workspaceId}`,
              payloadDigest,
              JSON.stringify({ workspaceId, status: "archived" }),
            ],
          );
        },
      });
      if (result.response.workspace === null) throw new ProblemError("internal_error");
      return { response: { workspace: result.response.workspace }, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  /**
   * Explicit draft-to-active transition. Starting the first Run may perform the
   * same transition after `assertCanStartRun` succeeds.
   */
  async activateWorkspace(
    actorId: string,
    workspaceId: string,
    input: ActivateWorkspaceInput,
    expectedRevision: number | undefined,
    commandId: string,
  ): Promise<WorkspaceCommandResult<WorkspaceCommandEnvelope>> {
    const revision = requiredRevision(expectedRevision);
    const payloadDigest = requiredDigest(input.payloadDigest);
    const response: { workspace: SharedWorkspaceView | null } = { workspace: null };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          assertWorkspaceWritable(access);
          assertOperatorAuthority(access);
          if (access.workspace.revision !== revision) {
            throw new ProblemError("revision_conflict", { revision: access.workspace.revision });
          }
          if (access.workspace.status === "active") {
            response.workspace = access.workspace;
            return;
          }
          assertStartable(access);
          await assertOperatorAndApprover(transaction, workspaceId);

          const now = this.#now().toISOString();
          await transaction.execute(
            "UPDATE workspace SET status = 'active', revision = revision + 1 WHERE id = ?",
            [workspaceId],
          );
          await transaction.execute(
            "UPDATE workspace_control SET revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
            [now, workspaceId],
          );
          response.workspace = {
            ...access.workspace,
            status: "active",
            revision: access.workspace.revision + 1,
          };
          await transaction.execute(
            "INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, 'workspace.activated', ?, NULL, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              workspaceId,
              workspaceId,
              actorId,
              now,
              JSON.stringify({ kind: "workspace_members" }),
              `workspace:${workspaceId}`,
              payloadDigest,
              JSON.stringify({ workspaceId, status: "active" }),
            ],
          );
        },
      });
      if (result.response.workspace === null) throw new ProblemError("internal_error");
      return { response: { workspace: result.response.workspace }, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async inviteWorkspaceMembers(
    actorId: string,
    workspaceId: string,
    input: InviteWorkspaceMembersInput,
    commandId: string,
  ): Promise<WorkspaceCommandResult<InviteWorkspaceMembersResult>> {
    if (!Array.isArray(input.members) || input.members.length === 0) {
      throw new ProblemError("invalid_request", { detail: "members must not be empty." });
    }
    const payloadDigest = requiredDigest(input.payloadDigest);
    const response: InviteWorkspaceMembersResult & {
      membership: WorkspaceMemberView | null;
      memberships: WorkspaceMemberView[];
    } = { membership: null, memberships: [] };

    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          assertWorkspaceRole(access, ["owner"]);
          assertWorkspaceWritable(access);

          const now = this.#now().toISOString();
          for (const invitation of input.members) {
            const userId = requiredText(invitation.userId, "members.userId", 200);
            if (!isWorkspaceRole(invitation.role)) {
              throw new ProblemError("invalid_request", { detail: "Unsupported workspace role." });
            }
            const isOwner = userId === access.workspace.ownerId;
            if (invitation.role === "owner" && !isOwner) {
              throw new ProblemError("invalid_request", {
                detail: "Ownership transfer is not part of member invitation.",
              });
            }
            await ensureUserRow(
              transaction,
              userId,
              isOwner ? "Workspace Owner" : "Workspace Member",
              now,
            );
            const role: WorkspaceRole = isOwner ? "owner" : invitation.role;
            const canApprove = isOwner || invitation.canApprove === true;
            const canReview = isOwner || invitation.canReview === true;
            await transaction.execute(
              `INSERT INTO workspace_member
                 (workspace_id, user_id, role, can_approve, can_review, joined_at, left_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT(workspace_id, user_id) DO UPDATE SET
                 role = excluded.role,
                 can_approve = excluded.can_approve,
                 can_review = excluded.can_review,
                 joined_at = excluded.joined_at,
                 left_at = NULL`,
              [workspaceId, userId, role, canApprove ? 1 : 0, canReview ? 1 : 0, now],
            );
          }

          const initialOperator = input.members.find(
            (invitation) =>
              invitation.role === "operator" && invitation.userId !== access.workspace.ownerId,
          );
          if (
            initialOperator !== undefined &&
            access.activeRunId === null &&
            access.currentOperator.operatorId === access.workspace.ownerId
          ) {
            // Draft setup assigns the first invited operator without changing the
            // epoch. Active-run responsibility changes still require Handoff.
            await transaction.execute(
              "UPDATE workspace_control SET operator_id = ?, updated_at = ? WHERE workspace_id = ? AND operator_id = ? AND active_run_id IS NULL",
              [initialOperator.userId, now, workspaceId, access.workspace.ownerId],
            );
          }

          const memberRows = await transaction.query<MemberRow>(
            `SELECT workspace_id AS workspaceId, user_id AS userId, role,
                    can_approve AS canApprove, can_review AS canReview,
                    joined_at AS joinedAt, left_at AS leftAt
               FROM workspace_member
              WHERE workspace_id = ? AND left_at IS NULL
              ORDER BY joined_at ASC, user_id ASC`,
            [workspaceId],
          );
          response.memberships = memberRows.map(memberView);
          response.membership = response.memberships[0] ?? null;

          await transaction.execute("UPDATE workspace SET revision = revision + 1 WHERE id = ?", [
            workspaceId,
          ]);
          await transaction.execute(
            "UPDATE workspace_control SET revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
            [now, workspaceId],
          );
          await transaction.execute(
            "INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, 'workspace.members_invited', ?, NULL, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              workspaceId,
              workspaceId,
              actorId,
              now,
              JSON.stringify({ kind: "workspace_members" }),
              `workspace:${workspaceId}`,
              payloadDigest,
              JSON.stringify({
                workspaceId,
                members: response.memberships.map((member) => ({
                  userId: member.userId,
                  role: member.role,
                })),
              }),
            ],
          );
        },
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  /**
   * Read-side precondition used by the Run route before delegating to the Run
   * service. It rejects observers/contributors, stale operator epochs, archived
   * workspaces, incomplete drafts, active Runs and missing operator/approver.
   */
  async assertCanStartRun(
    actorId: string,
    workspaceId: string,
    operatorEpoch: number,
  ): Promise<{ workspace: SharedWorkspaceView; access: WorkspaceAccess }> {
    return this.assertCanStartRunInTransaction(this.#database, actorId, workspaceId, operatorEpoch);
  }

  async assertCanStartRunInTransaction(
    transaction: SqliteTransaction,
    actorId: string,
    workspaceId: string,
    operatorEpoch: number,
  ): Promise<{ workspace: SharedWorkspaceView; access: WorkspaceAccess }> {
    if (!Number.isSafeInteger(operatorEpoch) || operatorEpoch < 1) {
      throw new ProblemError("invalid_request", {
        detail: "operatorEpoch must be a positive integer.",
      });
    }
    const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
    if (access.currentOperator.operatorId !== actorId) throw new ProblemError("permission_denied");
    assertStartable(access);
    if (access.currentOperator.operatorEpoch !== operatorEpoch) {
      throw new ProblemError("operator_changed");
    }
    if (access.activeRunId !== null) throw new ProblemError("task_active");
    await assertOperatorAndApprover(transaction, workspaceId);
    return { workspace: access.workspace, access };
  }
}

export function createWorkspacesService(options: WorkspacesServiceOptions): WorkspacesService {
  return new WorkspacesService(options);
}
