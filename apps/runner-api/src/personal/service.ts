import type {
  SqliteDatabase,
  SqliteTransaction,
} from "../../../../packages/persistence/src/database.js";
import { openDatabase } from "../../../../packages/persistence/src/database.js";
import {
  CURRENT_SCHEMA_VERSION,
  foundationMigrations,
  runMigrations,
} from "../../../../packages/persistence/src/migrations.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";

export interface PersonalServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly runnerId?: string;
  readonly agentProfileId?: string;
  readonly modelProvider?: "faux" | "openai-compatible" | "opencode-go";
  readonly modelId?: string;
  readonly modelSecretRef?: string;
}

export interface PersonalTaskInput {
  readonly name: string;
  readonly goal: string;
  readonly completionCriteria: string;
  readonly runnerId: string;
  readonly agentProfileId: string;
}

export interface PersonalCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

const WORKSPACE_SELECT = `
  SELECT w.id, w.kind, w.team_id AS teamId, w.owner_id AS ownerId, w.runner_id AS runnerId,
         w.name, w.goal, w.completion_criteria AS completionCriteria, w.status, w.visibility,
         w.agent_config_snapshot AS agentConfigSnapshot, w.federation_mode AS federationMode,
         w.revision, w.created_at AS createdAt, w.archived_at AS archivedAt,
         c.operator_id AS operatorId, c.operator_epoch AS operatorEpoch
  FROM workspace w
  JOIN workspace_control c ON c.workspace_id = w.id
`;

function text(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} is required and must be within its length limit.`,
    });
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ProblemError("invalid_request", { detail: `${field} must be a positive integer.` });
  }
  return value;
}

function payloadDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new ProblemError("invalid_request", {
      detail: "payloadDigest must be a SHA-256 digest.",
    });
  }
  return value;
}

function view(row: Record<string, unknown>): Record<string, unknown> {
  const snapshot =
    typeof row.agentConfigSnapshot === "string" ? JSON.parse(row.agentConfigSnapshot) : {};
  return {
    id: row.id,
    kind: row.kind,
    teamId: row.teamId,
    ownerId: row.ownerId,
    runnerId: row.runnerId,
    name: row.name,
    goal: row.goal,
    completionCriteria: row.completionCriteria,
    status: row.status,
    visibility: row.visibility,
    agentConfigSnapshot: snapshot,
    federationMode: row.federationMode,
    revision: row.revision,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
    pinned: snapshot.pinned === true,
    currentOperator: { operatorId: row.operatorId, operatorEpoch: row.operatorEpoch },
  };
}

async function workspaceRow(transaction: SqliteTransaction, actorId: string, workspaceId: string) {
  const rows = await transaction.query<Record<string, unknown>>(
    `${WORKSPACE_SELECT} WHERE w.id = ? AND w.owner_id = ? AND w.kind = 'personal'`,
    [workspaceId, actorId],
  );
  const row = rows[0];
  if (row === undefined) throw new ProblemError("not_found");
  return row;
}

export class PersonalService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #runnerId: string | undefined;
  readonly #agentProfileId: string | undefined;
  readonly #modelProvider: "faux" | "openai-compatible" | "opencode-go";
  readonly #modelId: string;
  readonly #modelSecretRef: string;

  constructor(options: PersonalServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
    this.#runnerId = options.runnerId;
    this.#agentProfileId = options.agentProfileId;
    this.#modelProvider = options.modelProvider ?? "faux";
    this.#modelId = options.modelId ?? "faux-model";
    this.#modelSecretRef = options.modelSecretRef ?? "faux://not-applicable";
  }

  async createTask(
    actorId: string,
    input: PersonalTaskInput & { payloadDigest: string },
    commandId: string,
  ): Promise<PersonalCommandResult<{ workspace: Record<string, unknown> }>> {
    const name = text(input.name, "name", 50);
    const goal = text(input.goal, "goal");
    const completionCriteria = text(input.completionCriteria, "completionCriteria");
    const runnerId = text(input.runnerId, "runnerId", 200);
    const agentProfileId = text(input.agentProfileId, "agentProfileId", 200);
    const digest = payloadDigest(input.payloadDigest);
    if (
      (this.#runnerId !== undefined && runnerId !== this.#runnerId) ||
      (this.#agentProfileId !== undefined && agentProfileId !== this.#agentProfileId)
    ) {
      const profiles = await this.#database.query(
        `SELECT r.status, p.enabled FROM runner r
         JOIN model_profile p ON p.runner_id = r.id
         WHERE r.id = ? AND p.id = ? AND r.status = 'available' AND p.enabled = 1`,
        [runnerId, agentProfileId],
      );
      if (profiles.length === 0) throw new ProblemError("runner_unavailable");
    }
    const id = this.#newId();
    const now = this.#now().toISOString();
    const workspace = {
      id,
      kind: "personal",
      teamId: null,
      ownerId: actorId,
      runnerId,
      name,
      goal,
      completionCriteria,
      status: "active",
      visibility: "owner_private",
      agentConfigSnapshot: {
        provider: this.#modelProvider,
        model: this.#modelId,
        agentProfileId,
        pinned: false,
      },
      federationMode: "disabled",
      revision: 1,
      createdAt: now,
      archivedAt: null,
      pinned: false,
      currentOperator: { operatorId: actorId, operatorEpoch: 1 },
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId: id,
        commandId,
        payloadDigest: digest,
        response: { workspace },
        mutate: async (transaction) => {
          await transaction.execute(
            "INSERT OR IGNORE INTO user (id, display_name, status, auth_version, created_at) VALUES (?, ?, 'active', 1, ?)",
            [actorId, "Personal Owner", now],
          );
          await transaction.execute(
            "INSERT OR IGNORE INTO runner (id, team_id, name, purpose, status, version, capabilities, policy_revision, last_heartbeat_at) VALUES (?, NULL, 'Local Runner', 'personal', 'available', '0.1.0', '[]', 0, ?)",
            [runnerId, now],
          );
          await transaction.execute(
            `INSERT INTO model_profile (id, runner_id, provider, model, reasoning_options, secret_ref, enabled)
             VALUES (?, ?, ?, ?, '{}', ?, 1)
             ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, model = excluded.model,
               secret_ref = excluded.secret_ref, enabled = 1`,
            [agentProfileId, runnerId, this.#modelProvider, this.#modelId, this.#modelSecretRef],
          );
          await transaction.execute(
            `INSERT INTO workspace (id, kind, team_id, owner_id, runner_id, name, goal, completion_criteria, status, visibility, agent_config_snapshot, federation_mode, revision, created_at, archived_at) VALUES (?, 'personal', NULL, ?, ?, ?, ?, ?, 'active', 'owner_private', ?, 'disabled', 1, ?, NULL)`,
            [
              id,
              actorId,
              runnerId,
              name,
              goal,
              completionCriteria,
              JSON.stringify(workspace.agentConfigSnapshot),
              now,
            ],
          );
          await transaction.execute(
            "INSERT INTO workspace_control (workspace_id, operator_id, operator_epoch, active_run_id, active_run_epoch, revision, updated_at) VALUES (?, ?, 1, NULL, 0, 1, ?)",
            [id, actorId, now],
          );
        },
        events: [
          {
            type: "personal_task.created",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "owner_private" },
            payloadDigest: digest,
            payload: { workspaceId: id },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError)
        throw new ProblemError("revision_conflict");
      throw error;
    }
  }

  async getTask(
    actorId: string,
    workspaceId: string,
  ): Promise<{ workspace: Record<string, unknown> }> {
    return { workspace: view(await workspaceRow(this.#database, actorId, workspaceId)) };
  }

  async listTasks(
    actorId: string,
    options: { search?: string; includeArchived?: boolean } = {},
  ): Promise<{ personalTasks: Record<string, unknown>[] }> {
    const rows = await this.#database.query<Record<string, unknown>>(
      `${WORKSPACE_SELECT} WHERE w.owner_id = ? AND w.kind = 'personal'`,
      [actorId],
    );
    const search = options.search?.trim().toLowerCase();
    const personalTasks = rows.map(view).filter((workspace) => {
      if (options.includeArchived !== true && workspace.status === "archived") return false;
      if (search === undefined || search.length === 0) return true;
      return `${String(workspace.name)} ${String(workspace.goal)}`.toLowerCase().includes(search);
    });
    personalTasks.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        String(right.createdAt).localeCompare(String(left.createdAt)),
    );
    return { personalTasks };
  }

  async setPinned(
    actorId: string,
    workspaceId: string,
    pinned: boolean,
  ): Promise<{ workspace: Record<string, unknown> }> {
    await this.#database.write(async (transaction) => {
      const row = await workspaceRow(transaction, actorId, workspaceId);
      const snapshot = JSON.parse(String(row.agentConfigSnapshot)) as Record<string, unknown>;
      snapshot.pinned = pinned;
      await transaction.execute(
        "UPDATE workspace SET agent_config_snapshot = ?, revision = revision + 1 WHERE id = ?",
        [JSON.stringify(snapshot), workspaceId],
      );
      await transaction.execute(
        "UPDATE workspace_control SET revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
        [this.#now().toISOString(), workspaceId],
      );
    });
    return this.getTask(actorId, workspaceId);
  }

  async setArchived(
    actorId: string,
    workspaceId: string,
    archived: boolean,
  ): Promise<{ workspace: Record<string, unknown> }> {
    await this.#database.write(async (transaction) => {
      await workspaceRow(transaction, actorId, workspaceId);
      const now = this.#now().toISOString();
      await transaction.execute(
        "UPDATE workspace SET status = ?, archived_at = ?, revision = revision + 1 WHERE id = ?",
        [archived ? "archived" : "active", archived ? now : null, workspaceId],
      );
      await transaction.execute(
        "UPDATE workspace_control SET revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
        [now, workspaceId],
      );
    });
    return this.getTask(actorId, workspaceId);
  }

  async takeover(
    actorId: string,
    workspaceId: string,
    input: { operatorEpoch: number; reason: string },
    expectedRevision?: number,
  ): Promise<{ workspace: Record<string, unknown> }> {
    integer(input.operatorEpoch, "operatorEpoch");
    text(input.reason, "reason", 2_000);
    await this.#database.write(async (transaction) => {
      const row = await workspaceRow(transaction, actorId, workspaceId);
      if (expectedRevision !== undefined && row.revision !== expectedRevision)
        throw new ProblemError("revision_conflict");
      if (row.operatorEpoch !== input.operatorEpoch) throw new ProblemError("operator_changed");
      const now = this.#now().toISOString();
      await transaction.execute(
        "UPDATE workspace_control SET operator_epoch = operator_epoch + 1, revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
        [now, workspaceId],
      );
      await transaction.execute("UPDATE workspace SET revision = revision + 1 WHERE id = ?", [
        workspaceId,
      ]);
    });
    return this.getTask(actorId, workspaceId);
  }
}

export async function openPersonalService(
  options: Omit<PersonalServiceOptions, "database"> & { dataDir: string },
) {
  const database = await openDatabase({
    filename: `${options.dataDir.replace(/[\\/]+$/, "")}/unspool.sqlite`,
  });
  await runMigrations(database, foundationMigrations);
  return {
    service: new PersonalService({ ...options, database }),
    database,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    close: () => database.close(),
  };
}
