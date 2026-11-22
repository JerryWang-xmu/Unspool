import { createHash } from "node:crypto";
import {
  createMembership,
  effectiveMembershipStatus,
  type MembershipStatus,
} from "../../../../packages/domain/src/membership.js";
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

export const RUNNER_MANAGED_STATUSES = ["available", "disabled"] as const;
export type RunnerManagedStatus = (typeof RUNNER_MANAGED_STATUSES)[number];

export interface RunnerServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface RunnerCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

export interface RunnerRegistrationInput {
  readonly name: string;
  readonly purpose: string;
  readonly version: string;
  readonly capabilities?: readonly string[];
  readonly allowedSubjects: readonly string[];
  readonly scopes?: readonly string[];
  readonly defaultPolicy?: Record<string, unknown>;
  readonly payloadDigest: string;
}

export interface RunnerUpdateInput {
  readonly name?: string;
  readonly purpose?: string;
  readonly status?: "available" | "disabled";
  readonly allowedSubjects?: readonly string[];
  readonly scopes?: readonly string[];
  readonly defaultPolicy?: Record<string, unknown>;
  readonly payloadDigest: string;
}

export interface ModelProfileUpsertInput {
  readonly profileId?: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningOptions?: Record<string, unknown>;
  readonly credential?: string;
  readonly enabled: boolean;
  readonly payloadDigest: string;
}

export interface RunnerView {
  readonly id: string;
  readonly teamId: string | null;
  readonly name: string;
  readonly purpose: string;
  readonly status: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly allowedSubjects: readonly string[];
  readonly scopes: readonly string[];
  readonly defaultPolicy: Record<string, unknown>;
  readonly revision: number;
  readonly lastHeartbeatAt: string;
}

export interface ModelProfileView {
  readonly id: string;
  readonly profileId: string;
  readonly runnerId: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningOptions: Record<string, unknown>;
  readonly enabled: boolean;
}

export interface RunnerAuthorization {
  readonly authorized: boolean;
  readonly runnerId: string;
  readonly teamId: string | null;
  readonly status: string | null;
  readonly allowedSubjects: readonly string[];
  readonly scopes: readonly string[];
  readonly reason?:
    | "not_found"
    | "disabled"
    | "team_inactive"
    | "subject_not_allowed"
    | "scope_not_granted";
}

interface TeamRow {
  readonly id: string;
}

interface MembershipRow {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly teamRoles: string;
  readonly status: MembershipStatus;
  readonly expiresAt: string | null;
}

interface RunnerRow {
  readonly id: string;
  readonly teamId: string | null;
  readonly name: string;
  readonly purpose: string;
  readonly status: string;
  readonly version: string;
  readonly capabilities: string;
  readonly policyRevision: number;
  readonly lastHeartbeatAt: string;
}

interface RunnerGrantRow {
  readonly runnerId: string;
  readonly teamId: string | null;
  readonly subjectType: "user" | "team";
  readonly subjectId: string;
  readonly allowedPolicy: string;
}

interface ModelProfileRow {
  readonly id: string;
  readonly runnerId: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningOptions: string;
  readonly secretRef: string;
  readonly enabled: number;
}

interface RunnerPolicy {
  readonly scopes: string[];
  readonly defaultPolicy: Record<string, unknown>;
}

const RUNNER_SELECT = `
  SELECT id, team_id AS teamId, name, purpose, status, version, capabilities,
         policy_revision AS policyRevision, last_heartbeat_at AS lastHeartbeatAt
  FROM runner
`;

const GRANT_SELECT = `
  SELECT runner_id AS runnerId, team_id AS teamId, subject_type AS subjectType,
         subject_id AS subjectId, allowed_policy AS allowedPolicy
  FROM runner_grant
`;

const PROFILE_SELECT = `
  SELECT id, runner_id AS runnerId, provider, model,
         reasoning_options AS reasoningOptions, secret_ref AS secretRef, enabled
  FROM model_profile
`;

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} is required and must be within its length limit.`,
    });
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProblemError("invalid_request", { detail: `${field} must be an array.` });
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new ProblemError("invalid_request", {
        detail: `${field} must contain non-empty strings.`,
      });
    }
    if (!entries.includes(entry)) {
      entries.push(entry);
    }
  }
  return entries;
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

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Stored JSON object is invalid");
  }
  return parsed as Record<string, unknown>;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new TypeError("Stored JSON array is invalid");
  }
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

function parsePolicy(value: string | undefined): RunnerPolicy {
  if (value === undefined) {
    return { scopes: [], defaultPolicy: {} };
  }
  const parsed = parseJsonObject(value);
  const scopes = Array.isArray(parsed.scopes)
    ? parsed.scopes.filter((entry): entry is string => typeof entry === "string")
    : [];
  const defaultPolicy =
    typeof parsed.defaultPolicy === "object" &&
    parsed.defaultPolicy !== null &&
    !Array.isArray(parsed.defaultPolicy)
      ? (parsed.defaultPolicy as Record<string, unknown>)
      : {};
  return { scopes, defaultPolicy };
}

function grantsPolicy(scopes: readonly string[], defaultPolicy: Record<string, unknown>): string {
  return JSON.stringify({ scopes, defaultPolicy });
}

function runnerView(row: RunnerRow, grants: readonly RunnerGrantRow[]): RunnerView {
  const teamPolicy = grants.find((grant) => grant.subjectType === "team");
  const userGrants = grants.filter((grant) => grant.subjectType === "user");
  const policy = parsePolicy(teamPolicy?.allowedPolicy ?? userGrants[0]?.allowedPolicy);
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    version: row.version,
    capabilities: parseStringArray(row.capabilities),
    allowedSubjects: userGrants.map((grant) => grant.subjectId),
    scopes: policy.scopes,
    defaultPolicy: policy.defaultPolicy,
    revision: row.policyRevision,
    lastHeartbeatAt: row.lastHeartbeatAt,
  };
}

function profileView(row: ModelProfileRow): ModelProfileView {
  return {
    id: row.id,
    profileId: row.id,
    runnerId: row.runnerId,
    provider: row.provider,
    model: row.model,
    reasoningOptions: parseJsonObject(row.reasoningOptions),
    enabled: row.enabled === 1,
  };
}

function membershipFromRow(row: MembershipRow) {
  return createMembership({
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    teamRoles: JSON.parse(row.teamRoles) as ("administrator" | "member")[],
    status: row.status,
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
  });
}

export class RunnerService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: RunnerServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async registerRunner(
    actorId: string,
    teamId: string,
    input: RunnerRegistrationInput,
    commandId: string,
  ): Promise<RunnerCommandResult<{ runner: RunnerView }>> {
    const name = requiredText(input.name, "name", 200);
    const purpose = requiredText(input.purpose, "purpose", 2_000);
    const version = requiredText(input.version, "version", 100);
    const capabilities =
      input.capabilities === undefined ? [] : stringArray(input.capabilities, "capabilities");
    const allowedSubjects = stringArray(input.allowedSubjects, "allowedSubjects");
    const scopes = input.scopes === undefined ? [] : stringArray(input.scopes, "scopes");
    const defaultPolicy =
      input.defaultPolicy === undefined ? {} : objectValue(input.defaultPolicy, "defaultPolicy");
    const digest = payloadDigest(input.payloadDigest);
    const now = this.#now().toISOString();
    const runnerId = this.#newId();
    const response = { runner: {} as RunnerView };

    return this.#commit({
      actorId,
      workspaceId: teamId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        const teamRows = await transaction.query<TeamRow>("SELECT id FROM team WHERE id = ?", [
          teamId,
        ]);
        if (teamRows[0] === undefined) {
          throw new ProblemError("not_found");
        }
        await this.#requireAdministrator(transaction, actorId, teamId, now);
        await transaction.execute(
          `INSERT INTO runner (
             id, team_id, name, purpose, status, version, capabilities,
             policy_revision, last_heartbeat_at
           ) VALUES (?, ?, ?, ?, 'available', ?, ?, 1, ?)`,
          [runnerId, teamId, name, purpose, version, JSON.stringify(capabilities), now],
        );
        await this.#replaceGrants(
          transaction,
          runnerId,
          teamId,
          allowedSubjects,
          scopes,
          defaultPolicy,
        );
        response.runner = runnerView(
          {
            id: runnerId,
            teamId,
            name,
            purpose,
            status: "available",
            version,
            capabilities: JSON.stringify(capabilities),
            policyRevision: 1,
            lastHeartbeatAt: now,
          },
          await this.#grants(transaction, runnerId),
        );
      },
    });
  }

  async updateRunner(
    actorId: string,
    runnerId: string,
    input: RunnerUpdateInput,
    commandId: string,
    expectedRevision?: number,
  ): Promise<RunnerCommandResult<{ runner: RunnerView }>> {
    const name = input.name === undefined ? undefined : requiredText(input.name, "name", 200);
    const purpose =
      input.purpose === undefined ? undefined : requiredText(input.purpose, "purpose", 2_000);
    const status =
      input.status === undefined
        ? undefined
        : (RUNNER_MANAGED_STATUSES as readonly string[]).includes(input.status)
          ? input.status
          : (() => {
              throw new ProblemError("invalid_request", {
                detail: "Runner status may only be set to available or disabled.",
              });
            })();
    const allowedSubjects =
      input.allowedSubjects === undefined
        ? undefined
        : stringArray(input.allowedSubjects, "allowedSubjects");
    const scopes = input.scopes === undefined ? undefined : stringArray(input.scopes, "scopes");
    const defaultPolicy =
      input.defaultPolicy === undefined
        ? undefined
        : objectValue(input.defaultPolicy, "defaultPolicy");
    if (
      name === undefined &&
      purpose === undefined &&
      status === undefined &&
      allowedSubjects === undefined &&
      scopes === undefined &&
      defaultPolicy === undefined
    ) {
      throw new ProblemError("invalid_request", {
        detail: "At least one runner field must be supplied.",
      });
    }
    const digest = payloadDigest(input.payloadDigest);
    const response = { runner: {} as RunnerView };
    const workspaceId = await this.#runnerTeamId(runnerId);

    return this.#commit({
      actorId,
      workspaceId: workspaceId ?? runnerId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        const current = await this.#runner(transaction, runnerId);
        if (current === null) {
          throw new ProblemError("not_found");
        }
        const now = this.#now().toISOString();
        if (current.teamId === null) {
          throw new ProblemError("permission_denied");
        }
        await this.#requireAdministrator(transaction, actorId, current.teamId, now);
        if (expectedRevision !== undefined && current.policyRevision !== expectedRevision) {
          throw new ProblemError("revision_conflict");
        }
        const existingGrants = await this.#grants(transaction, runnerId);
        const existingPolicy = runnerView(current, existingGrants);
        const nextSubjects = allowedSubjects ?? existingPolicy.allowedSubjects;
        const nextScopes = scopes ?? existingPolicy.scopes;
        const nextDefaultPolicy = defaultPolicy ?? existingPolicy.defaultPolicy;
        const nextName = name ?? current.name;
        const nextPurpose = purpose ?? current.purpose;
        const nextStatus = status ?? current.status;
        const revision = current.policyRevision + 1;
        await transaction.execute(
          `UPDATE runner SET name = ?, purpose = ?, status = ?, policy_revision = ?
           WHERE id = ?`,
          [nextName, nextPurpose, nextStatus, revision, runnerId],
        );
        await this.#replaceGrants(
          transaction,
          runnerId,
          current.teamId,
          nextSubjects,
          nextScopes,
          nextDefaultPolicy,
        );
        response.runner = runnerView(
          {
            ...current,
            name: nextName,
            purpose: nextPurpose,
            status: nextStatus,
            policyRevision: revision,
          },
          await this.#grants(transaction, runnerId),
        );
      },
    });
  }

  async upsertModelProfile(
    actorId: string,
    runnerId: string,
    input: ModelProfileUpsertInput,
    commandId: string,
  ): Promise<RunnerCommandResult<{ profile: ModelProfileView }>> {
    const provider = requiredText(input.provider, "provider", 100);
    const model = requiredText(input.model, "model", 200);
    const reasoningOptions =
      input.reasoningOptions === undefined
        ? {}
        : objectValue(input.reasoningOptions, "reasoningOptions");
    if (typeof input.enabled !== "boolean") {
      throw new ProblemError("invalid_request", { detail: "enabled must be a boolean." });
    }
    const enabled = input.enabled;
    const credential =
      input.credential === undefined ? undefined : requiredText(input.credential, "credential");
    const digest = payloadDigest(input.payloadDigest);
    const profileId = input.profileId ?? this.#newId();
    const response = { profile: {} as ModelProfileView };
    const workspaceId = await this.#runnerTeamId(runnerId);

    return this.#commit({
      actorId,
      workspaceId: workspaceId ?? runnerId,
      commandId,
      payloadDigest: digest,
      response,
      mutate: async (transaction) => {
        const runner = await this.#runner(transaction, runnerId);
        if (runner === null) {
          throw new ProblemError("not_found");
        }
        const now = this.#now().toISOString();
        if (runner.teamId === null) {
          throw new ProblemError("permission_denied");
        }
        await this.#requireAdministrator(transaction, actorId, runner.teamId, now);
        const existingRows = await transaction.query<ModelProfileRow>(
          `${PROFILE_SELECT} WHERE id = ?`,
          [profileId],
        );
        const existing = existingRows[0];
        if (existing !== undefined && existing.runnerId !== runnerId) {
          throw new ProblemError("not_found");
        }
        const secretRef = this.#secretRef(provider, credential, existing);
        if (existing === undefined) {
          await transaction.execute(
            `INSERT INTO model_profile (
               id, runner_id, provider, model, reasoning_options, secret_ref, enabled
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              profileId,
              runnerId,
              provider,
              model,
              JSON.stringify(reasoningOptions),
              secretRef,
              enabled ? 1 : 0,
            ],
          );
        } else {
          await transaction.execute(
            `UPDATE model_profile
             SET provider = ?, model = ?, reasoning_options = ?, secret_ref = ?, enabled = ?
             WHERE id = ? AND runner_id = ?`,
            [
              provider,
              model,
              JSON.stringify(reasoningOptions),
              secretRef,
              enabled ? 1 : 0,
              profileId,
              runnerId,
            ],
          );
        }
        response.profile = profileView({
          id: profileId,
          runnerId,
          provider,
          model,
          reasoningOptions: JSON.stringify(reasoningOptions),
          secretRef,
          enabled: enabled ? 1 : 0,
        });
      },
    });
  }

  async listModelProfiles(
    actorId: string,
    runnerId: string,
  ): Promise<{ modelProfiles: ModelProfileView[] }> {
    const runner = await this.#runner(this.#database, runnerId);
    if (runner === null) {
      throw new ProblemError("not_found");
    }
    if (runner.teamId !== null) {
      await this.#requireActiveMembership(
        this.#database,
        actorId,
        runner.teamId,
        this.#now().toISOString(),
      );
    }
    const rows = await this.#database.query<ModelProfileRow>(
      `${PROFILE_SELECT} WHERE runner_id = ? ORDER BY rowid`,
      [runnerId],
    );
    return { modelProfiles: rows.map(profileView) };
  }

  async listTeamRunners(actorId: string, teamId: string): Promise<{ runners: RunnerView[] }> {
    const now = this.#now().toISOString();
    await this.#requireActiveMembership(this.#database, actorId, teamId, now);
    const rows = await this.#database.query<RunnerRow>(
      `${RUNNER_SELECT} WHERE team_id = ? ORDER BY rowid`,
      [teamId],
    );
    const runners: RunnerView[] = [];
    for (const row of rows) {
      runners.push(runnerView(row, await this.#grants(this.#database, row.id)));
    }
    return { runners };
  }

  async listVisibleRunners(actorId: string): Promise<{ runners: RunnerView[] }> {
    const rows = await this.#database.query<RunnerRow>(`${RUNNER_SELECT} ORDER BY rowid`);
    const runners: RunnerView[] = [];
    for (const row of rows) {
      const authorization = await this.authorizeRunner(actorId, row.id);
      if (authorization.authorized)
        runners.push(runnerView(row, await this.#grants(this.#database, row.id)));
    }
    return { runners };
  }

  async authorizeRunner(
    actorId: string,
    runnerId: string,
    scope?: string,
  ): Promise<RunnerAuthorization> {
    const runner = await this.#runner(this.#database, runnerId);
    if (runner === null) {
      return {
        authorized: false,
        runnerId,
        teamId: null,
        status: null,
        allowedSubjects: [],
        scopes: [],
        reason: "not_found",
      };
    }
    const view = runnerView(runner, await this.#grants(this.#database, runnerId));
    if (view.status === "disabled") {
      return { ...authorizationBase(view), authorized: false, reason: "disabled" };
    }
    if (view.teamId !== null) {
      const membership = await this.#membership(this.#database, view.teamId, actorId);
      if (
        membership === null ||
        effectiveMembershipStatus(membership, this.#now().toISOString()) !== "active"
      ) {
        return { ...authorizationBase(view), authorized: false, reason: "team_inactive" };
      }
    }
    if (!view.allowedSubjects.includes(actorId)) {
      return {
        ...authorizationBase(view),
        authorized: false,
        reason: "subject_not_allowed",
      };
    }
    if (scope !== undefined && view.scopes.length > 0 && !view.scopes.includes(scope)) {
      return {
        ...authorizationBase(view),
        authorized: false,
        reason: "scope_not_granted",
      };
    }
    return { ...authorizationBase(view), authorized: true };
  }

  async assertRunnerAuthorized(
    actorId: string,
    runnerId: string,
    scope?: string,
  ): Promise<RunnerAuthorization> {
    const authorization = await this.authorizeRunner(actorId, runnerId, scope);
    if (authorization.authorized) {
      return authorization;
    }
    switch (authorization.reason) {
      case "not_found":
        throw new ProblemError("not_found");
      case "disabled":
        throw new ProblemError("runner_unavailable");
      default:
        throw new ProblemError("permission_denied");
    }
  }

  #secretRef(
    provider: string,
    credential: string | undefined,
    existing: ModelProfileRow | undefined,
  ): string {
    if (provider === "faux") {
      return "faux://not-applicable";
    }
    if (credential !== undefined) {
      const digest = createHash("sha256").update(credential, "utf8").digest("hex");
      return `secret://sha256/${digest}`;
    }
    if (existing !== undefined) {
      return existing.secretRef;
    }
    throw new ProblemError("invalid_request", {
      detail: "A credential is required for non-faux model providers.",
    });
  }

  async #commit<T>(command: CommandUnitOfWork<T>): Promise<RunnerCommandResult<T>> {
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

  async #runnerTeamId(runnerId: string): Promise<string | null> {
    const runner = await this.#runner(this.#database, runnerId);
    return runner?.teamId ?? null;
  }

  async #runner(transaction: SqliteTransaction, runnerId: string): Promise<RunnerRow | null> {
    const rows = await transaction.query<RunnerRow>(`${RUNNER_SELECT} WHERE id = ?`, [runnerId]);
    return rows[0] ?? null;
  }

  async #grants(transaction: SqliteTransaction, runnerId: string): Promise<RunnerGrantRow[]> {
    return transaction.query<RunnerGrantRow>(`${GRANT_SELECT} WHERE runner_id = ? ORDER BY rowid`, [
      runnerId,
    ]);
  }

  async #replaceGrants(
    transaction: SqliteTransaction,
    runnerId: string,
    teamId: string | null,
    allowedSubjects: readonly string[],
    scopes: readonly string[],
    defaultPolicy: Record<string, unknown>,
  ): Promise<void> {
    await transaction.execute("DELETE FROM runner_grant WHERE runner_id = ?", [runnerId]);
    const allowedPolicy = grantsPolicy(scopes, defaultPolicy);
    if (teamId !== null) {
      await transaction.execute(
        `INSERT INTO runner_grant (runner_id, team_id, subject_type, subject_id, allowed_policy)
         VALUES (?, ?, 'team', ?, ?)`,
        [runnerId, teamId, teamId, allowedPolicy],
      );
    }
    for (const subjectId of allowedSubjects) {
      await transaction.execute(
        `INSERT INTO runner_grant (runner_id, team_id, subject_type, subject_id, allowed_policy)
         VALUES (?, NULL, 'user', ?, ?)`,
        [runnerId, subjectId, allowedPolicy],
      );
    }
  }

  async #membership(transaction: SqliteTransaction, teamId: string, userId: string) {
    const rows = await transaction.query<MembershipRow>(
      `SELECT id, team_id AS teamId, user_id AS userId, team_roles AS teamRoles,
              status, expires_at AS expiresAt
       FROM membership WHERE team_id = ? AND user_id = ?`,
      [teamId, userId],
    );
    const row = rows[0];
    return row === undefined ? null : membershipFromRow(row);
  }

  async #requireActiveMembership(
    transaction: SqliteTransaction,
    actorId: string,
    teamId: string,
    now: string,
  ): Promise<void> {
    const teamRows = await transaction.query<TeamRow>("SELECT id FROM team WHERE id = ?", [teamId]);
    if (teamRows[0] === undefined) {
      throw new ProblemError("not_found");
    }
    const membership = await this.#membership(transaction, teamId, actorId);
    if (membership === null || effectiveMembershipStatus(membership, now) !== "active") {
      throw new ProblemError("permission_denied");
    }
  }

  async #requireAdministrator(
    transaction: SqliteTransaction,
    actorId: string,
    teamId: string,
    now: string,
  ): Promise<void> {
    const membership = await this.#membership(transaction, teamId, actorId);
    if (
      membership === null ||
      effectiveMembershipStatus(membership, now) !== "active" ||
      !membership.teamRoles.includes("administrator")
    ) {
      throw new ProblemError("permission_denied");
    }
  }
}

function authorizationBase(view: RunnerView) {
  return {
    runnerId: view.id,
    teamId: view.teamId,
    status: view.status,
    allowedSubjects: view.allowedSubjects,
    scopes: view.scopes,
  };
}
