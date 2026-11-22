import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";
import { loadWorkspaceAccess } from "../workspaces/service.js";

export const OFFLINE_TAKEOVER_THRESHOLD_MS = 120_000;

export interface TakeoverServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface TakeoverInput {
  readonly kind: "offline" | "forced";
  readonly operatorEpoch: number;
  readonly reason?: string;
  readonly payloadDigest: string;
}

export class TakeoverService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: TakeoverServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async takeover(
    actorId: string,
    workspaceId: string,
    input: TakeoverInput,
    commandId: string,
    expectedRevision: number | undefined,
  ) {
    if (input.kind !== "offline" && input.kind !== "forced")
      throw new ProblemError("invalid_request");
    if (!Number.isInteger(input.operatorEpoch) || input.operatorEpoch < 1)
      throw new ProblemError("invalid_request");
    if (!/^sha256:[0-9a-f]{64}$/.test(input.payloadDigest))
      throw new ProblemError("invalid_request");
    if (expectedRevision === undefined)
      throw new ProblemError("invalid_request", { detail: "If-Match is required." });
    if (input.kind === "forced" && (input.reason === undefined || input.reason.trim().length === 0))
      throw new ProblemError("invalid_request", {
        detail: "Forced takeover requires a non-blank reason.",
      });
    const now = this.#now().toISOString();
    const response: Record<string, unknown> = {
      operatorId: actorId,
      previousOperatorId: null,
      operatorEpoch: input.operatorEpoch + 1,
      kind: input.kind,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest: input.payloadDigest,
        response,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          if (input.kind === "forced" && access.role !== "owner")
            throw new ProblemError("permission_denied");
          if (input.kind === "offline" && access.currentOperator.operatorId === actorId)
            throw new ProblemError("permission_denied");
          const controls = await transaction.query<{ operatorId: string; operatorEpoch: number }>(
            "SELECT operator_id AS operatorId, operator_epoch AS operatorEpoch FROM workspace_control WHERE workspace_id = ?",
            [workspaceId],
          );
          const control = controls[0];
          if (control === undefined) throw new ProblemError("not_found");
          if (control.operatorEpoch !== input.operatorEpoch)
            throw new ProblemError("operator_changed");
          if (access.workspace.revision !== expectedRevision)
            throw new ProblemError("revision_conflict", { revision: access.workspace.revision });
          if (input.kind === "offline") {
            const presence = await transaction.query<{ lastSeenAt: string }>(
              "SELECT last_seen_at AS lastSeenAt FROM workspace_presence WHERE workspace_id = ? AND user_id = ?",
              [workspaceId, control.operatorId],
            );
            const lastSeenAt = presence[0]?.lastSeenAt;
            if (
              lastSeenAt === undefined ||
              Date.parse(now) - Date.parse(lastSeenAt) <= OFFLINE_TAKEOVER_THRESHOLD_MS
            ) {
              throw new ProblemError("permission_denied", {
                detail: "The current operator has not been offline for more than two minutes.",
              });
            }
          }
          const nextEpoch = control.operatorEpoch + 1;
          await transaction.execute(
            "UPDATE workspace_control SET operator_id = ?, operator_epoch = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND operator_epoch = ?",
            [actorId, nextEpoch, now, workspaceId, control.operatorEpoch],
          );
          await transaction.execute("UPDATE workspace SET revision = revision + 1 WHERE id = ?", [
            workspaceId,
          ]);
          await transaction.execute(
            "UPDATE run SET operator_epoch = ? WHERE workspace_id = ? AND state IN ('created', 'running', 'waiting_approval', 'stopping', 'needs_confirmation')",
            [nextEpoch, workspaceId],
          );
          await transaction.execute(
            "INSERT INTO workspace_presence (workspace_id, user_id, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
            [workspaceId, actorId, now],
          );
          Object.assign(response, {
            previousOperatorId: control.operatorId,
            operatorEpoch: nextEpoch,
          });
        },
        events: [
          {
            eventId: this.#newId(),
            type: "handoff.takeover",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest: input.payloadDigest,
            payload: {
              kind: input.kind,
              reason: input.reason ?? input.kind,
              previousOperatorId: response.previousOperatorId,
              operatorId: actorId,
              operatorEpoch: response.operatorEpoch,
            },
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
}
