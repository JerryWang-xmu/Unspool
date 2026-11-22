import {
  createMembership,
  effectiveMembershipStatus,
  type Membership,
  type MembershipAccess,
  type MembershipEffectiveStatus,
  type MembershipStatus,
  membershipAccess,
  TEAM_ROLES,
  type TeamRole,
} from "../../../../packages/domain/src/membership.js";
import { createTeam as createTeamModel } from "../../../../packages/domain/src/team.js";
import type { WorkspaceMemberRole } from "../../../../packages/domain/src/workspace-member.js";
import type {
  SqliteDatabase,
  SqliteTransaction,
} from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  type CommandUnitOfWork,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";

export interface TeamServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface TeamCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

export interface CreateTeamInput {
  readonly name: string;
  readonly defaultPolicyRevision?: number;
  readonly payloadDigest: string;
}

export interface UpdateTeamInput {
  readonly name?: string;
  readonly betaEnabled?: boolean;
  readonly defaultPolicy?: Record<string, unknown>;
  readonly payloadDigest: string;
}

export interface InviteTeamMemberInput {
  readonly userId: string;
  readonly teamRoles: readonly string[];
  readonly expiresAt?: string;
  readonly payloadDigest: string;
}

export interface UpdateTeamMembershipInput {
  readonly status?: "active" | "disabled";
  readonly teamRoles?: readonly string[];
  readonly expiresAt?: string | null;
  readonly payloadDigest: string;
}

export interface TeamView {
  readonly id: string;
  readonly name: string;
  readonly betaEnabled: boolean;
  readonly defaultPolicyRevision: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly ownerId: string | null;
}

export interface MembershipView {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly teamRoles: readonly TeamRole[];
  readonly status: MembershipStatus;
  readonly effectiveStatus: MembershipEffectiveStatus;
  readonly expiresAt: string | null;
  readonly isOwner: boolean;
  readonly revision: number;
  readonly access: MembershipAccess;
}

export interface TeamAccess extends MembershipAccess {
  readonly found: boolean;
  readonly teamId: string;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly teamRoles: readonly TeamRole[];
  readonly status: MembershipStatus | null;
}

export interface WorkspaceAccess extends MembershipAccess {
  readonly found: boolean;
  readonly workspaceId: string;
  readonly teamId: string | null;
  readonly kind: "personal" | "shared";
  readonly status: string;
  readonly workspaceRole: WorkspaceMemberRole | "owner" | "administrator" | null;
  readonly membershipId: string | null;
}

export type WorkspaceAccessKind = "read" | "operate" | "historical" | "session";

interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly betaEnabled: number;
  readonly defaultPolicyRevision: number;
  readonly createdAt: string;
}

interface MembershipRow {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly teamRoles: string;
  readonly status: MembershipStatus;
  readonly expiresAt: string | null;
}

interface WorkspaceRow {
  readonly id: string;
  readonly kind: "personal" | "shared";
  readonly teamId: string | null;
  readonly ownerId: string;
  readonly status: string;
}

interface WorkspaceMemberRow {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceMemberRole;
  readonly leftAt: string | null;
}

const TEAM_SELECT = `
  SELECT id, name, beta_enabled AS betaEnabled,
         default_policy_revision AS defaultPolicyRevision, created_at AS createdAt
  FROM team
`;

const MEMBERSHIP_SELECT = `
  SELECT id, team_id AS teamId, user_id AS userId, team_roles AS teamRoles,
         status, expires_at AS expiresAt
  FROM membership
`;

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} is required and must be within its length limit.`,
    });
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ProblemError("invalid_request", {
      detail: `${field} must be a positive integer.`,
    });
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ProblemError("invalid_request", { detail: `${field} must be a boolean.` });
  }
  return value;
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProblemError("invalid_request", { detail: `${field} must be an object.` });
  }
  return value as Record<string, unknown>;
}

function payloadDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new ProblemError("invalid_request", {
      detail: "payloadDigest must be a SHA-256 digest.",
    });
  }
  return value;
}

function expiresAtValue(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ProblemError("invalid_request", {
      detail: "expiresAt must be an RFC 3339 instant.",
    });
  }
  return value;
}

function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

function teamRolesValue(value: unknown): TeamRole[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProblemError("invalid_request", {
      detail: "teamRoles must contain at least one role.",
    });
  }
  const roles: TeamRole[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isTeamRole(entry)) {
      throw new ProblemError("invalid_request", {
        detail: "Only administrator and member team roles are supported.",
      });
    }
    if (roles.includes(entry)) {
      throw new ProblemError("invalid_request", {
        detail: "teamRoles must not contain duplicates.",
      });
    }
    roles.push(entry);
  }
  return roles;
}

function parseStoredRoles(value: string): TeamRole[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TypeError("Stored membership teamRoles is invalid");
  }
  const roles: TeamRole[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || !isTeamRole(entry)) {
      throw new TypeError("Stored membership contains an unsupported team role");
    }
    roles.push(entry);
  }
  return roles;
}

function membershipFromRow(row: MembershipRow): Membership {
  return createMembership({
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    teamRoles: parseStoredRoles(row.teamRoles),
    status: row.status,
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
  });
}

function membershipView(
  row: MembershipRow,
  now: string,
  ownerId: string | null,
  revision: number,
): MembershipView {
  const membership = membershipFromRow(row);
  const access = membershipAccess(membership, now);
  return {
    id: membership.id,
    teamId: membership.teamId,
    userId: membership.userId,
    teamRoles: membership.teamRoles,
    status: membership.status,
    effectiveStatus: access.effectiveStatus,
    expiresAt: membership.expiresAt ?? null,
    isOwner: membership.userId === ownerId,
    revision,
    access,
  };
}

function teamView(row: TeamRow, ownerId: string | null): TeamView {
  return {
    id: row.id,
    name: row.name,
    betaEnabled: row.betaEnabled === 1,
    defaultPolicyRevision: row.defaultPolicyRevision,
    revision: row.defaultPolicyRevision,
    createdAt: row.createdAt,
    ownerId,
  };
}

function deniedTeamAccess(teamId: string, userId: string): TeamAccess {
  return {
    effectiveStatus: "disabled",
    identityActive: false,
    existingSessionsActive: false,
    workspaceReadActive: false,
    workspaceOperationsActive: false,
    historicalWorkspaceReadActive: false,
    attributionPreserved: true,
    found: false,
    teamId,
    userId,
    membershipId: null,
    teamRoles: [],
    status: null,
  };
}

export class TeamService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: TeamServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async createTeam(
    actorId: string,
    input: CreateTeamInput,
    commandId: string,
  ): Promise<TeamCommandResult<{ team: TeamView; membership: MembershipView }>> {
    const name = requiredText(input.name, "name", 100);
    const digest = payloadDigest(input.payloadDigest);
    const defaultPolicyRevision =
      input.defaultPolicyRevision === undefined
        ? 1
        : positiveInteger(input.defaultPolicyRevision, "defaultPolicyRevision");
    const now = this.#now().toISOString();
    const teamId = this.#newId();
    const membershipId = this.#newId();
    const team = createTeamModel({ id: teamId, name, defaultPolicyRevision, createdAt: now });
    const membership = createMembership({
      id: membershipId,
      teamId,
      userId: actorId,
      teamRoles: ["administrator"],
    });
    const response = {
      team: {} as TeamView,
      membership: {} as MembershipView,
    };

    return this.#commit({
      actorId,
      workspaceId: teamId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        await ensureUser(transaction, actorId, now);
        await transaction.execute(
          `INSERT INTO team (id, name, beta_enabled, default_policy_revision, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            team.id,
            team.name,
            team.betaEnabled ? 1 : 0,
            team.defaultPolicyRevision,
            team.createdAt,
          ],
        );
        await transaction.execute(
          `INSERT INTO membership (id, team_id, user_id, team_roles, status, expires_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [
            membership.id,
            membership.teamId,
            membership.userId,
            JSON.stringify(membership.teamRoles),
            membership.status,
          ],
        );
        response.team = teamView(
          {
            id: team.id,
            name: team.name,
            betaEnabled: team.betaEnabled ? 1 : 0,
            defaultPolicyRevision: team.defaultPolicyRevision,
            createdAt: team.createdAt,
          },
          actorId,
        );
        response.membership = membershipView(
          {
            id: membership.id,
            teamId: membership.teamId,
            userId: membership.userId,
            teamRoles: JSON.stringify(membership.teamRoles),
            status: membership.status,
            expiresAt: null,
          },
          now,
          actorId,
          team.defaultPolicyRevision,
        );
      },
    });
  }

  async listTeams(actorId: string): Promise<{ teams: TeamView[] }> {
    const now = this.#now().toISOString();
    const memberships = await this.#database.query<MembershipRow>(
      `${MEMBERSHIP_SELECT} WHERE user_id = ? ORDER BY rowid`,
      [actorId],
    );
    const teams: TeamView[] = [];
    for (const membershipRow of memberships) {
      const membership = membershipFromRow(membershipRow);
      if (effectiveMembershipStatus(membership, now) !== "active") {
        continue;
      }
      const team = await this.#team(membership.teamId);
      if (team === null) {
        continue;
      }
      const ownerId = await this.#ownerId(team.id, now);
      teams.push(teamView(team, ownerId));
    }
    return { teams };
  }

  async updateTeam(
    actorId: string,
    teamId: string,
    input: UpdateTeamInput,
    commandId: string,
    expectedRevision?: number,
  ): Promise<TeamCommandResult<{ team: TeamView }>> {
    const digest = payloadDigest(input.payloadDigest);
    const name = input.name === undefined ? undefined : requiredText(input.name, "name", 100);
    const betaEnabled =
      input.betaEnabled === undefined ? undefined : booleanValue(input.betaEnabled, "betaEnabled");
    const defaultPolicy =
      input.defaultPolicy === undefined
        ? undefined
        : objectValue(input.defaultPolicy, "defaultPolicy");
    if (name === undefined && betaEnabled === undefined && defaultPolicy === undefined) {
      throw new ProblemError("invalid_request", {
        detail: "At least one team field must be supplied.",
      });
    }
    const response = { team: {} as TeamView };

    return this.#commit({
      actorId,
      workspaceId: teamId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        const rows = await transaction.query<TeamRow>(`${TEAM_SELECT} WHERE id = ?`, [teamId]);
        const current = rows[0];
        if (current === undefined) {
          throw new ProblemError("not_found");
        }
        const now = this.#now().toISOString();
        await this.#requireAdministrator(transaction, actorId, teamId, now);
        if (expectedRevision !== undefined && current.defaultPolicyRevision !== expectedRevision) {
          throw new ProblemError("revision_conflict");
        }
        const revision = current.defaultPolicyRevision + 1;
        const nextName = name ?? current.name;
        const nextBetaEnabled = betaEnabled ?? current.betaEnabled === 1;
        await transaction.execute(
          `UPDATE team SET name = ?, beta_enabled = ?, default_policy_revision = ?
           WHERE id = ?`,
          [nextName, nextBetaEnabled ? 1 : 0, revision, teamId],
        );
        const ownerId = await this.#ownerId(teamId, now, transaction);
        response.team = teamView(
          {
            id: current.id,
            name: nextName,
            betaEnabled: nextBetaEnabled ? 1 : 0,
            defaultPolicyRevision: revision,
            createdAt: current.createdAt,
          },
          ownerId,
        );
      },
    });
  }

  async listMembers(
    actorId: string,
    teamId: string,
  ): Promise<{
    teamId: string;
    revision: number;
    ownerId: string | null;
    members: MembershipView[];
  }> {
    const now = this.#now().toISOString();
    const team = await this.#team(teamId);
    if (team === null) {
      throw new ProblemError("not_found");
    }
    await this.assertTeamAccess(actorId, teamId, "member", now);
    const ownerId = await this.#ownerId(teamId, now);
    const rows = await this.#database.query<MembershipRow>(
      `${MEMBERSHIP_SELECT} WHERE team_id = ? ORDER BY rowid`,
      [teamId],
    );
    return {
      teamId,
      revision: team.defaultPolicyRevision,
      ownerId,
      members: rows.map((row) => membershipView(row, now, ownerId, team.defaultPolicyRevision)),
    };
  }

  async inviteMember(
    actorId: string,
    teamId: string,
    input: InviteTeamMemberInput,
    commandId: string,
  ): Promise<TeamCommandResult<{ membership: MembershipView }>> {
    const userId = requiredText(input.userId, "userId", 200);
    const roles = teamRolesValue(input.teamRoles);
    const expiresAt = input.expiresAt === undefined ? undefined : expiresAtValue(input.expiresAt);
    const digest = payloadDigest(input.payloadDigest);
    const now = this.#now().toISOString();
    let membershipId = this.#newId();
    const response = { membership: {} as MembershipView };

    return this.#commit({
      actorId,
      workspaceId: teamId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        const team = await this.#teamInTransaction(transaction, teamId);
        if (team === null) {
          throw new ProblemError("not_found");
        }
        await this.#requireAdministrator(transaction, actorId, teamId, now);
        await ensureUser(transaction, userId, now);
        const existingRows = await transaction.query<MembershipRow>(
          `${MEMBERSHIP_SELECT} WHERE team_id = ? AND user_id = ?`,
          [teamId, userId],
        );
        const existing = existingRows[0];
        if (existing !== undefined) {
          membershipId = existing.id;
          await this.#assertAdminBoundary(
            transaction,
            teamId,
            membershipId,
            {
              teamRoles: roles,
              status: "active",
              ...(expiresAt === undefined ? {} : { expiresAt }),
            },
            now,
          );
          await transaction.execute(
            `UPDATE membership SET team_roles = ?, status = 'active', expires_at = ?
             WHERE id = ?`,
            [JSON.stringify(roles), expiresAt ?? null, membershipId],
          );
        } else {
          await this.#assertAdminBoundary(
            transaction,
            teamId,
            membershipId,
            {
              teamRoles: roles,
              status: "active",
              ...(expiresAt === undefined ? {} : { expiresAt }),
            },
            now,
          );
          await transaction.execute(
            `INSERT INTO membership (id, team_id, user_id, team_roles, status, expires_at)
             VALUES (?, ?, ?, ?, 'active', ?)`,
            [membershipId, teamId, userId, JSON.stringify(roles), expiresAt ?? null],
          );
        }
        const revision = team.defaultPolicyRevision + 1;
        await transaction.execute("UPDATE team SET default_policy_revision = ? WHERE id = ?", [
          revision,
          teamId,
        ]);
        const ownerId = await this.#ownerId(teamId, now, transaction);
        response.membership = membershipView(
          {
            id: membershipId,
            teamId,
            userId,
            teamRoles: JSON.stringify(roles),
            status: "active",
            expiresAt: expiresAt ?? null,
          },
          now,
          ownerId,
          revision,
        );
      },
    });
  }

  async updateMembership(
    actorId: string,
    teamId: string,
    membershipId: string,
    input: UpdateTeamMembershipInput,
    commandId: string,
    expectedRevision?: number,
  ): Promise<TeamCommandResult<{ membership: MembershipView }>> {
    const status =
      input.status === undefined
        ? undefined
        : input.status === "active" || input.status === "disabled"
          ? input.status
          : (() => {
              throw new ProblemError("invalid_request", {
                detail: "status must be active or disabled.",
              });
            })();
    const roles = input.teamRoles === undefined ? undefined : teamRolesValue(input.teamRoles);
    const expiresAt =
      input.expiresAt === undefined
        ? undefined
        : input.expiresAt === null
          ? null
          : expiresAtValue(input.expiresAt);
    if (status === undefined && roles === undefined && expiresAt === undefined) {
      throw new ProblemError("invalid_request", {
        detail: "At least one membership field must be supplied.",
      });
    }
    const digest = payloadDigest(input.payloadDigest);
    const response = { membership: {} as MembershipView };

    return this.#commit({
      actorId,
      workspaceId: teamId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        const team = await this.#teamInTransaction(transaction, teamId);
        if (team === null) {
          throw new ProblemError("not_found");
        }
        const now = this.#now().toISOString();
        await this.#requireAdministrator(transaction, actorId, teamId, now);
        if (expectedRevision !== undefined && team.defaultPolicyRevision !== expectedRevision) {
          throw new ProblemError("revision_conflict");
        }
        const rows = await transaction.query<MembershipRow>(
          `${MEMBERSHIP_SELECT} WHERE id = ? AND team_id = ?`,
          [membershipId, teamId],
        );
        const current = rows[0];
        if (current === undefined) {
          throw new ProblemError("not_found");
        }
        const currentMembership = membershipFromRow(current);
        const nextRoles = roles ?? [...currentMembership.teamRoles];
        const nextStatus = status ?? currentMembership.status;
        const nextExpiresAt =
          expiresAt === undefined ? (currentMembership.expiresAt ?? null) : expiresAt;
        await this.#assertAdminBoundary(
          transaction,
          teamId,
          membershipId,
          {
            teamRoles: nextRoles,
            status: nextStatus,
            ...(nextExpiresAt === null ? {} : { expiresAt: nextExpiresAt }),
          },
          now,
        );
        await transaction.execute(
          "UPDATE membership SET team_roles = ?, status = ?, expires_at = ? WHERE id = ?",
          [JSON.stringify(nextRoles), nextStatus, nextExpiresAt, membershipId],
        );
        const revision = team.defaultPolicyRevision + 1;
        await transaction.execute("UPDATE team SET default_policy_revision = ? WHERE id = ?", [
          revision,
          teamId,
        ]);
        const ownerId = await this.#ownerId(teamId, now, transaction);
        response.membership = membershipView(
          {
            id: membershipId,
            teamId,
            userId: current.userId,
            teamRoles: JSON.stringify(nextRoles),
            status: nextStatus,
            expiresAt: nextExpiresAt,
          },
          now,
          ownerId,
          revision,
        );
      },
    });
  }

  async getMembershipAccess(userId: string, teamId: string, at?: string): Promise<TeamAccess> {
    const now = at ?? this.#now().toISOString();
    const rows = await this.#database.query<MembershipRow>(
      `${MEMBERSHIP_SELECT} WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    const row = rows[0];
    if (row === undefined) {
      return deniedTeamAccess(teamId, userId);
    }
    const membership = membershipFromRow(row);
    const access = membershipAccess(membership, now);
    return {
      ...access,
      found: true,
      teamId,
      userId,
      membershipId: membership.id,
      teamRoles: membership.teamRoles,
      status: membership.status,
    };
  }

  async getWorkspaceAccess(
    userId: string,
    workspaceId: string,
    at?: string,
  ): Promise<WorkspaceAccess | null> {
    const now = at ?? this.#now().toISOString();
    const rows = await this.#database.query<WorkspaceRow>(
      `SELECT id, kind, team_id AS teamId, owner_id AS ownerId, status
       FROM workspace WHERE id = ?`,
      [workspaceId],
    );
    const workspace = rows[0];
    if (workspace === undefined) {
      return null;
    }
    if (workspace.kind === "personal") {
      const isOwner = workspace.ownerId === userId;
      return {
        effectiveStatus: isOwner ? "active" : "disabled",
        identityActive: isOwner,
        existingSessionsActive: isOwner,
        workspaceReadActive: isOwner,
        workspaceOperationsActive: isOwner,
        historicalWorkspaceReadActive: isOwner,
        attributionPreserved: true,
        found: true,
        workspaceId,
        teamId: null,
        kind: "personal",
        status: workspace.status,
        workspaceRole: isOwner ? "owner" : null,
        membershipId: null,
      };
    }
    if (workspace.teamId === null) {
      return null;
    }
    const teamAccess = await this.getMembershipAccess(userId, workspace.teamId, now);
    const memberRows = await this.#database.query<WorkspaceMemberRow>(
      `SELECT workspace_id AS workspaceId, user_id AS userId, role, left_at AS leftAt
       FROM workspace_member WHERE workspace_id = ? AND user_id = ?`,
      [workspaceId, userId],
    );
    const member = memberRows[0];
    const isOwner = workspace.ownerId === userId;
    const isAdministrator = teamAccess.teamRoles.includes("administrator");
    const isActiveMember = member !== undefined && member.leftAt === null;
    const visible = isOwner || isAdministrator || isActiveMember;
    const canOperate =
      isOwner ||
      isAdministrator ||
      (isActiveMember && member !== undefined && member.role !== "observer");
    const workspaceRole: WorkspaceAccess["workspaceRole"] = isOwner
      ? "owner"
      : isAdministrator
        ? "administrator"
        : (member?.role ?? null);
    return {
      effectiveStatus: teamAccess.effectiveStatus,
      identityActive: teamAccess.identityActive,
      existingSessionsActive: teamAccess.existingSessionsActive,
      workspaceReadActive: teamAccess.workspaceReadActive && visible,
      workspaceOperationsActive: teamAccess.workspaceOperationsActive && canOperate,
      historicalWorkspaceReadActive: teamAccess.historicalWorkspaceReadActive && visible,
      attributionPreserved: true,
      found: true,
      workspaceId,
      teamId: workspace.teamId,
      kind: "shared",
      status: workspace.status,
      workspaceRole,
      membershipId: teamAccess.membershipId,
    };
  }

  async assertTeamAccess(
    actorId: string,
    teamId: string,
    role: TeamRole = "member",
    at?: string,
  ): Promise<TeamAccess> {
    const team = await this.#team(teamId);
    if (team === null) {
      throw new ProblemError("not_found");
    }
    const access = await this.getMembershipAccess(actorId, teamId, at);
    if (!access.identityActive) {
      throw new ProblemError("permission_denied");
    }
    if (role === "administrator" && !access.teamRoles.includes("administrator")) {
      throw new ProblemError("permission_denied");
    }
    return access;
  }

  async assertWorkspaceAccess(
    actorId: string,
    workspaceId: string,
    kind: WorkspaceAccessKind = "read",
    at?: string,
  ): Promise<WorkspaceAccess> {
    const access = await this.getWorkspaceAccess(actorId, workspaceId, at);
    if (access === null) {
      throw new ProblemError("not_found");
    }
    const allowed =
      kind === "read"
        ? access.workspaceReadActive
        : kind === "operate"
          ? access.workspaceOperationsActive
          : kind === "historical"
            ? access.historicalWorkspaceReadActive
            : access.existingSessionsActive;
    if (!allowed) {
      throw new ProblemError("permission_denied");
    }
    return access;
  }

  async #commit<T>(command: CommandUnitOfWork<T>): Promise<TeamCommandResult<T>> {
    try {
      const result = await commitCommandUnitOfWork(this.#database, command);
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async #team(teamId: string): Promise<TeamRow | null> {
    const rows = await this.#database.query<TeamRow>(`${TEAM_SELECT} WHERE id = ?`, [teamId]);
    return rows[0] ?? null;
  }

  async #teamInTransaction(
    transaction: SqliteTransaction,
    teamId: string,
  ): Promise<TeamRow | null> {
    const rows = await transaction.query<TeamRow>(`${TEAM_SELECT} WHERE id = ?`, [teamId]);
    return rows[0] ?? null;
  }

  async #ownerId(
    teamId: string,
    now: string,
    transaction: SqliteTransaction = this.#database,
  ): Promise<string | null> {
    const rows = await transaction.query<MembershipRow>(
      `${MEMBERSHIP_SELECT} WHERE team_id = ? ORDER BY rowid`,
      [teamId],
    );
    for (const row of rows) {
      const membership = membershipFromRow(row);
      if (
        membership.teamRoles.includes("administrator") &&
        effectiveMembershipStatus(membership, now) === "active"
      ) {
        return membership.userId;
      }
    }
    return null;
  }

  async #requireAdministrator(
    transaction: SqliteTransaction,
    actorId: string,
    teamId: string,
    now: string,
  ): Promise<void> {
    const rows = await transaction.query<MembershipRow>(
      `${MEMBERSHIP_SELECT} WHERE team_id = ? AND user_id = ?`,
      [teamId, actorId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ProblemError("permission_denied");
    }
    const membership = membershipFromRow(row);
    if (
      effectiveMembershipStatus(membership, now) !== "active" ||
      !membership.teamRoles.includes("administrator")
    ) {
      throw new ProblemError("permission_denied");
    }
  }

  async #assertAdminBoundary(
    transaction: SqliteTransaction,
    teamId: string,
    targetMembershipId: string,
    next: {
      readonly teamRoles: readonly TeamRole[];
      readonly status: MembershipStatus;
      readonly expiresAt?: string;
    },
    now: string,
  ): Promise<void> {
    const rows = await transaction.query<MembershipRow>(`${MEMBERSHIP_SELECT} WHERE team_id = ?`, [
      teamId,
    ]);
    const target = rows.find((row) => row.id === targetMembershipId);
    if (target === undefined) {
      return;
    }
    const targetMembership = membershipFromRow(target);
    if (
      !targetMembership.teamRoles.includes("administrator") ||
      effectiveMembershipStatus(targetMembership, now) !== "active"
    ) {
      return;
    }
    const nextIsActiveAdministrator =
      next.teamRoles.includes("administrator") &&
      next.status === "active" &&
      (next.expiresAt === undefined || Date.parse(next.expiresAt) > Date.parse(now));
    if (nextIsActiveAdministrator) {
      return;
    }
    const anotherActiveAdministrator = rows.some((row) => {
      if (row.id === targetMembershipId) {
        return false;
      }
      const membership = membershipFromRow(row);
      return (
        membership.teamRoles.includes("administrator") &&
        effectiveMembershipStatus(membership, now) === "active"
      );
    });
    if (!anotherActiveAdministrator) {
      throw new ProblemError("permission_denied", {
        detail: "At least one active team administrator is required.",
      });
    }
  }
}

async function ensureUser(
  transaction: SqliteTransaction,
  userId: string,
  now: string,
): Promise<void> {
  await transaction.execute(
    `INSERT OR IGNORE INTO user (id, display_name, status, auth_version, created_at)
     VALUES (?, ?, 'active', 1, ?)`,
    [userId, userId, now],
  );
}
