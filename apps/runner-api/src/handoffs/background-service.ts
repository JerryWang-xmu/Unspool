import {
  createUnresolvedIssue,
  type UnresolvedIssueStatus,
  type UnresolvedIssueVisibility,
} from "../../../../packages/domain/src/unresolved-issue.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";
import { loadWorkspaceAccess } from "../workspaces/service.js";
import type { PreparationService } from "./preparation-service.js";

export interface BackgroundServiceOptions {
  readonly database: SqliteDatabase;
  readonly preparation: PreparationService;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface UnresolvedIssueInput {
  readonly body: string;
  readonly visibility?: UnresolvedIssueVisibility;
  readonly status?: UnresolvedIssueStatus;
  readonly payloadDigest: string;
}

export class BackgroundService {
  readonly #database: SqliteDatabase;
  readonly #preparation: PreparationService;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: BackgroundServiceOptions) {
    this.#database = options.database;
    this.#preparation = options.preparation;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async refresh(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    payloadDigest: string,
    commandId: string,
  ) {
    if (!/^sha256:[0-9a-f]{64}$/.test(payloadDigest)) throw new ProblemError("invalid_request");
    const now = this.#now().toISOString();
    const response: Record<string, unknown> = { refreshedAt: now, latestRecordedAt: now };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const preparation = await this.#preparation.getPreparation(
            actorId,
            workspaceId,
            handoffId,
          );
          const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
          const latestRevision = Math.max(
            Number(preparation.latestRevision),
            access.workspace.revision,
          );
          await transaction.execute(
            "UPDATE preparation_session SET latest_revision = ? WHERE id = ?",
            [latestRevision, preparation.id],
          );
          const issues = await transaction.query<Record<string, unknown>>(
            "SELECT id, preparation_session_id AS preparationSessionId, body, visibility, status FROM unresolved_issue WHERE preparation_session_id = ? ORDER BY rowid",
            [preparation.id],
          );
          Object.assign(response, {
            latestRevision,
            asOfRevision: preparation.asOfRevision,
            changed: latestRevision > Number(preparation.asOfRevision),
            goal: access.workspace.goal,
            unresolvedIssues: issues,
          });
        },
        events: [
          {
            type: "handoff.refreshed",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "member", memberId: actorId },
            payloadDigest,
            payload: { handoffId },
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

  async recordUnresolvedIssue(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    input: UnresolvedIssueInput,
    commandId: string,
  ) {
    if (
      typeof input.body !== "string" ||
      input.body.trim().length === 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(input.payloadDigest)
    )
      throw new ProblemError("invalid_request");
    const now = this.#now().toISOString();
    const response: Record<string, unknown> = {};
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest: input.payloadDigest,
        response,
        mutate: async (transaction) => {
          const preparation = await this.#preparation.getPreparation(
            actorId,
            workspaceId,
            handoffId,
          );
          const issue = createUnresolvedIssue({
            id: this.#newId(),
            preparationSessionId: String(preparation.id),
            body: input.body,
            ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
            ...(input.status === undefined ? {} : { status: input.status }),
          });
          await transaction.execute(
            "INSERT INTO unresolved_issue (id, preparation_session_id, body, visibility, status) VALUES (?, ?, ?, ?, ?)",
            [issue.id, issue.preparationSessionId, issue.body, issue.visibility, issue.status],
          );
          Object.assign(response, issue);
        },
        events:
          input.visibility === "shared"
            ? [
                {
                  type: "handoff.unresolved_issue_shared",
                  schemaVersion: 1,
                  occurredAt: now,
                  visibility: { kind: "workspace_members" },
                  payloadDigest: input.payloadDigest,
                  payload: { handoffId, body: input.body },
                },
              ]
            : [],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError)
        throw new ProblemError("revision_conflict");
      throw error;
    }
  }
}
