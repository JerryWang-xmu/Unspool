import type { HandoffSummary } from "../../../../packages/domain/src/handoff-summary.js";
import { createPreparationSession } from "../../../../packages/domain/src/preparation-session.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ContextService } from "../context/service.js";
import { ProblemError } from "../errors/problem.js";
import { loadWorkspaceAccess } from "../workspaces/service.js";
import { loadHandoffInvitation } from "./service.js";
import { readHandoffSummary } from "./summary.js";

export interface PreparationServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface PreparationSource {
  readonly sourceType: "context";
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly title: string;
  readonly body: string;
  readonly recordedAt: string;
}

export class PreparationService {
  readonly #database: SqliteDatabase;
  readonly #context: ContextService;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: PreparationServiceOptions) {
    this.#database = options.database;
    this.#context = new ContextService(options);
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async prepare(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    payloadDigest: string,
    commandId: string,
  ) {
    if (!/^sha256:[0-9a-f]{64}$/.test(payloadDigest)) throw new ProblemError("invalid_request");
    const now = this.#now().toISOString();
    const response: Record<string, unknown> = {
      handoffId,
      recipientId: actorId,
      status: "preparing",
      startedAt: now,
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
          if (!["invited", "preparing"].includes(invitation.status))
            throw new ProblemError("invalid_request");
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          const summary = await readHandoffSummary(transaction, invitation.summarySnapshotId);
          const existing = await transaction.query<Record<string, unknown>>(
            "SELECT * FROM preparation_session WHERE handoff_id = ? AND recipient_id = ?",
            [handoffId, actorId],
          );
          const row = existing[0];
          if (row !== undefined) {
            Object.assign(response, this.#view(row, summary));
            return;
          }
          const conversationId = this.#newId();
          const preparationId = this.#newId();
          await transaction.execute(
            "INSERT INTO agent_conversation (id, workspace_id, pi_session_ref, session_format_version, continuation_of_id, created_at) VALUES (?, ?, ?, 1, NULL, ?)",
            [conversationId, workspaceId, `preparations/${conversationId}.jsonl`, now],
          );
          const preparation = createPreparationSession({
            id: preparationId,
            handoffId,
            recipientId: actorId,
            readOnlyConversationId: conversationId,
            asOfRevision: summary.revision,
            latestRevision: access.workspace.revision,
            startedAt: now,
          });
          await transaction.execute(
            "INSERT INTO preparation_session (id, handoff_id, recipient_id, read_only_conversation_id, as_of_revision, latest_revision, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, 'preparing', ?, NULL)",
            [
              preparation.id,
              handoffId,
              actorId,
              conversationId,
              preparation.asOfRevision,
              preparation.latestRevision,
              now,
            ],
          );
          await transaction.execute(
            "UPDATE handoff_invitation SET status = 'preparing' WHERE id = ?",
            [handoffId],
          );
          Object.assign(response, {
            id: preparation.id,
            readOnlyConversationId: conversationId,
            asOfRevision: preparation.asOfRevision,
            latestRevision: preparation.latestRevision,
            summary,
          });
        },
        events: [
          {
            type: "handoff.preparation_started",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "member", memberId: actorId },
            payloadDigest,
            payload: { handoffId, recipientId: actorId },
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

  async getPreparation(
    actorId: string,
    workspaceId: string,
    handoffId: string,
  ): Promise<Record<string, unknown>> {
    const invitation = await loadHandoffInvitation(this.#database, workspaceId, handoffId);
    if (invitation.recipientId !== actorId) throw new ProblemError("permission_denied");
    const rows = await this.#database.query<Record<string, unknown>>(
      "SELECT * FROM preparation_session WHERE handoff_id = ? AND recipient_id = ?",
      [handoffId, actorId],
    );
    const row = rows[0];
    if (row === undefined) throw new ProblemError("not_found");
    const summary = await readHandoffSummary(this.#database, invitation.summarySnapshotId);
    return this.#view(row, summary);
  }

  async listRecipientSources(
    actorId: string,
    workspaceId: string,
    handoffId: string,
  ): Promise<PreparationSource[]> {
    await this.getPreparation(actorId, workspaceId, handoffId);
    const { contextItems } = await this.#context.listContextItems(actorId, workspaceId);
    return contextItems.map((item) => {
      const version = item.currentVersion;
      return {
        sourceType: "context" as const,
        sourceId: version.id,
        sourceRevision: version.version,
        title: version.title,
        body: version.body,
        recordedAt: version.attribution.occurredAt,
      };
    });
  }

  #view(row: Record<string, unknown>, summary: HandoffSummary): Record<string, unknown> {
    return {
      id: String(row.id),
      handoffId: String(row.handoff_id),
      recipientId: String(row.recipient_id),
      status: String(row.status),
      readOnlyConversationId: String(row.read_only_conversation_id),
      asOfRevision: Number(row.as_of_revision),
      latestRevision: Number(row.latest_revision),
      startedAt: String(row.started_at),
      ...(row.ended_at === null || row.ended_at === undefined
        ? {}
        : { endedAt: String(row.ended_at) }),
      summary,
    };
  }
}
