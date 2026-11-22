import type { HandoffInvitation } from "../../../../packages/domain/src/handoff-invitation.js";
import {
  createHandoffInvitation,
  isHandoffInvitationTerminal,
} from "../../../../packages/domain/src/handoff-invitation.js";
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
import { loadWorkspaceAccess } from "../workspaces/service.js";
import { buildHandoffSummary } from "./summary.js";

export interface HandoffServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface HandoffCommandInput {
  readonly payloadDigest: string;
}

export interface InviteHandoffInput extends HandoffCommandInput {
  readonly recipientId: string;
  readonly reason?: string;
  readonly expiresAt?: string;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new ProblemError("invalid_request");
  return value;
}

function invitationView(row: Record<string, unknown>): HandoffInvitation {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    fromOperatorId: String(row.from_operator_id),
    recipientId: String(row.recipient_id),
    summarySnapshotId: String(row.summary_snapshot_id),
    baseRevision: Number(row.base_revision),
    status: row.status as HandoffInvitation["status"],
    ...(row.reason === null || row.reason === undefined ? {} : { reason: String(row.reason) }),
    createdAt: String(row.created_at),
    ...(row.expires_at === null || row.expires_at === undefined
      ? {}
      : { expiresAt: String(row.expires_at) }),
  };
}

export async function loadHandoffInvitation(
  transaction: SqliteTransaction,
  workspaceId: string,
  handoffId: string,
): Promise<HandoffInvitation> {
  const rows = await transaction.query<Record<string, unknown>>(
    "SELECT * FROM handoff_invitation WHERE id = ? AND workspace_id = ?",
    [handoffId, workspaceId],
  );
  const row = rows[0];
  if (row === undefined) throw new ProblemError("not_found");
  return invitationView(row);
}

function commandError(error: unknown): never {
  if (error instanceof CommandRevisionConflictError) throw new ProblemError("revision_conflict");
  throw error;
}

export class HandoffService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: HandoffServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async invite(actorId: string, workspaceId: string, input: InviteHandoffInput, commandId: string) {
    const payloadDigest = digest(input.payloadDigest);
    if (typeof input.recipientId !== "string" || input.recipientId.trim().length === 0)
      throw new ProblemError("invalid_request");
    const now = this.#now().toISOString();
    const summaryId = this.#newId();
    const invitation = createHandoffInvitation({
      id: this.#newId(),
      workspaceId,
      fromOperatorId: actorId,
      recipientId: input.recipientId,
      summarySnapshotId: summaryId,
      baseRevision: 1,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      createdAt: now,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response: invitation,
        mutate: async (transaction) => {
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          if (access.currentOperator.operatorId !== actorId)
            throw new ProblemError("permission_denied");
          const recipients = await transaction.query(
            "SELECT user_id FROM workspace_member WHERE workspace_id = ? AND user_id = ? AND left_at IS NULL",
            [workspaceId, input.recipientId],
          );
          if (recipients.length === 0)
            throw new ProblemError("invalid_request", {
              detail: "recipientId must be an active workspace member.",
            });
          const summary = await buildHandoffSummary(transaction, workspaceId, () => summaryId);
          invitation.summarySnapshotId = summary.id;
          invitation.baseRevision = summary.revision;
          await transaction.execute(
            "INSERT INTO handoff_invitation (id, workspace_id, from_operator_id, recipient_id, summary_snapshot_id, base_revision, status, reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?)",
            [
              invitation.id,
              workspaceId,
              actorId,
              input.recipientId,
              summary.id,
              summary.revision,
              input.reason ?? null,
              now,
              input.expiresAt ?? null,
            ],
          );
        },
        events: [
          {
            type: "handoff.invited",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { handoffId: invitation.id, recipientId: input.recipientId },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      commandError(error);
    }
  }

  async accept(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    input: HandoffCommandInput,
    commandId: string,
    expectedRevision: number | undefined,
  ) {
    const payloadDigest = digest(input.payloadDigest);
    if (expectedRevision === undefined)
      throw new ProblemError("invalid_request", { detail: "If-Match is required." });
    const now = this.#now().toISOString();
    const response: Record<string, unknown> = {
      id: handoffId,
      status: "accepted",
      acceptedAt: now,
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const invitation = await loadHandoffInvitation(transaction, workspaceId, handoffId);
          if (invitation.recipientId !== actorId) throw new ProblemError("permission_denied");
          if (invitation.status !== "preparing")
            throw new ProblemError("invalid_request", {
              detail: "Accept requires an active preparation and refresh.",
            });
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          const preparations = await transaction.query<{ latestRevision: number }>(
            "SELECT latest_revision AS latestRevision FROM preparation_session WHERE handoff_id = ? AND recipient_id = ? AND status = 'preparing'",
            [handoffId, actorId],
          );
          const preparation = preparations[0];
          if (preparation === undefined) throw new ProblemError("invalid_request");
          if (
            access.workspace.revision !== expectedRevision ||
            preparation.latestRevision !== expectedRevision
          ) {
            throw new ProblemError("revision_conflict", { revision: access.workspace.revision });
          }
          const controls = await transaction.query<{ operatorId: string; operatorEpoch: number }>(
            "SELECT operator_id AS operatorId, operator_epoch AS operatorEpoch FROM workspace_control WHERE workspace_id = ?",
            [workspaceId],
          );
          const control = controls[0];
          if (control === undefined) throw new ProblemError("not_found");
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
            "UPDATE handoff_invitation SET status = 'accepted' WHERE id = ?",
            [handoffId],
          );
          await transaction.execute(
            "UPDATE preparation_session SET status = 'ended', ended_at = ? WHERE handoff_id = ? AND recipient_id = ?",
            [now, handoffId, actorId],
          );
          Object.assign(response, {
            operatorId: actorId,
            previousOperatorId: control.operatorId,
            operatorEpoch: nextEpoch,
          });
        },
        events: [
          {
            type: "handoff.accepted",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { handoffId, recipientId: actorId, expectedRevision },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      commandError(error);
    }
  }

  async reject(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    input: HandoffCommandInput & { reason: string },
    commandId: string,
  ) {
    const payloadDigest = digest(input.payloadDigest);
    if (typeof input.reason !== "string" || input.reason.trim().length === 0)
      throw new ProblemError("invalid_request");
    const response = { id: handoffId, status: "rejected", reason: input.reason };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const invitation = await loadHandoffInvitation(transaction, workspaceId, handoffId);
          if (invitation.recipientId !== actorId) throw new ProblemError("permission_denied");
          if (isHandoffInvitationTerminal(invitation.status))
            throw new ProblemError("invalid_request");
          await transaction.execute(
            "UPDATE handoff_invitation SET status = 'rejected', reason = ? WHERE id = ?",
            [input.reason, handoffId],
          );
        },
        events: [
          {
            type: "handoff.rejected",
            schemaVersion: 1,
            occurredAt: this.#now().toISOString(),
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { handoffId, recipientId: actorId },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      commandError(error);
    }
  }
}
