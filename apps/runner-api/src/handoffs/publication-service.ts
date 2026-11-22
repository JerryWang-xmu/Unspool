import {
  CLARIFICATION_TARGET_TYPES,
  type ClarificationTargetType,
  createClarificationPublication,
} from "../../../../packages/domain/src/clarification-publication.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";
import type { PreparationService } from "./preparation-service.js";

export interface PublicationServiceOptions {
  readonly database: SqliteDatabase;
  readonly preparation: PreparationService;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface PublicationInput {
  readonly targetType: ClarificationTargetType;
  readonly editedBody: string;
  readonly payloadDigest: string;
}

export class PublicationService {
  readonly #database: SqliteDatabase;
  readonly #preparation: PreparationService;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: PublicationServiceOptions) {
    this.#database = options.database;
    this.#preparation = options.preparation;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async publish(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    input: PublicationInput,
    commandId: string,
  ) {
    if (
      !CLARIFICATION_TARGET_TYPES.includes(input.targetType) ||
      typeof input.editedBody !== "string" ||
      input.editedBody.trim().length === 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(input.payloadDigest)
    ) {
      throw new ProblemError("invalid_request");
    }
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
          const targetId = this.#newId();
          if (input.targetType === "discussion") {
            await transaction.execute(
              "INSERT INTO input_item (id, workspace_id, kind, body, author_id, created_at, \"references\") VALUES (?, ?, 'discussion', ?, ?, ?, '[]')",
              [targetId, workspaceId, input.editedBody, actorId, now],
            );
          } else if (input.targetType === "context") {
            const versionId = this.#newId();
            await transaction.execute(
              "INSERT INTO context_item (id, workspace_id, kind, current_version_id, created_by, created_at, removed_at) VALUES (?, ?, 'decision', ?, ?, ?, NULL)",
              [targetId, workspaceId, versionId, actorId, now],
            );
            await transaction.execute(
              "INSERT INTO context_version (id, context_item_id, version, title, body, source_refs, member_visibility, agent_exposure, attribution, supersedes_id) VALUES (?, ?, 1, 'Handoff clarification', ?, '[]', 'members', 'not_provided', ?, NULL)",
              [
                versionId,
                targetId,
                input.editedBody,
                JSON.stringify({
                  actorId,
                  displayNameAtTime: "Recipient",
                  rolesAtTime: ["recipient"],
                  occurredAt: now,
                }),
              ],
            );
          }
          const publication = createClarificationPublication({
            id: this.#newId(),
            preparationSessionId: String(preparation.id),
            targetType: input.targetType,
            targetId,
            editedBody: input.editedBody,
            publishedBy: actorId,
            publishedAt: now,
          });
          await transaction.execute(
            "INSERT INTO clarification_publication (id, preparation_session_id, target_type, target_id, edited_body, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              publication.id,
              publication.preparationSessionId,
              publication.targetType,
              publication.targetId,
              publication.editedBody,
              publication.publishedBy,
              publication.publishedAt,
            ],
          );
          Object.assign(response, publication);
        },
        events: [
          {
            type: "handoff.clarification_published",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest: input.payloadDigest,
            payload: {
              handoffId,
              targetType: input.targetType,
              targetId: response.targetId ?? null,
              editedBody: input.editedBody,
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
