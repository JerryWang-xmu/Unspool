import { type Citation, createCitation } from "../../../../packages/domain/src/citation.js";
import { createPrivateQA } from "../../../../packages/domain/src/private-qa.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { answerPreparationQuestion } from "../../../../packages/pi-adapter/src/preparation-adapter.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";
import type { PreparationService } from "./preparation-service.js";

export interface AnswerServiceOptions {
  readonly database: SqliteDatabase;
  readonly preparation: PreparationService;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface PrivateQuestionInput {
  readonly question: string;
  readonly asOfRevision: number;
  readonly payloadDigest: string;
}

export class AnswerService {
  readonly #database: SqliteDatabase;
  readonly #preparation: PreparationService;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: AnswerServiceOptions) {
    this.#database = options.database;
    this.#preparation = options.preparation;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async ask(
    actorId: string,
    workspaceId: string,
    handoffId: string,
    input: PrivateQuestionInput,
    commandId: string,
  ) {
    if (typeof input.question !== "string" || input.question.trim().length === 0)
      throw new ProblemError("invalid_request");
    if (!/^sha256:[0-9a-f]{64}$/.test(input.payloadDigest))
      throw new ProblemError("invalid_request");
    const now = this.#now().toISOString();
    const response: Record<string, unknown> = { createdAt: now, citations: [] };
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
          const latestRevision = Number(preparation.latestRevision);
          const sources =
            input.asOfRevision === latestRevision
              ? await this.#preparation.listRecipientSources(actorId, workspaceId, handoffId)
              : [];
          const answer =
            input.asOfRevision === latestRevision
              ? answerPreparationQuestion(input.question, sources)
              : {
                  answerKind: "unknown" as const,
                  answer:
                    "Unknown: the background revision changed before this question; refresh before relying on an answer.",
                };
          const qa = createPrivateQA({
            id: this.#newId(),
            preparationSessionId: String(preparation.id),
            question: input.question,
            answer: answer.answer,
            asOfRevision: latestRevision,
            answerKind: answer.answerKind,
            createdAt: now,
          });
          await transaction.execute(
            "INSERT INTO private_qa (id, preparation_session_id, question, answer, as_of_revision, answer_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              qa.id,
              qa.preparationSessionId,
              qa.question,
              qa.answer,
              qa.asOfRevision,
              qa.answerKind,
              qa.createdAt,
            ],
          );
          const citations: Citation[] = [];
          if (answer.source !== undefined) {
            const citation = createCitation({
              privateQAId: qa.id,
              sourceType: answer.source.sourceType,
              sourceId: answer.source.sourceId,
              sourceRevision: answer.source.sourceRevision,
              recordedAt: now,
            });
            citations.push(citation);
            await transaction.execute(
              "INSERT INTO citation (private_qa_id, source_type, source_id, source_revision, recorded_at) VALUES (?, ?, ?, ?, ?)",
              [
                citation.privateQAId,
                citation.sourceType,
                citation.sourceId,
                citation.sourceRevision,
                citation.recordedAt,
              ],
            );
          }
          Object.assign(response, {
            id: qa.id,
            question: qa.question,
            answer: qa.answer,
            answerKind: qa.answerKind,
            asOfRevision: qa.asOfRevision,
            citations,
          });
        },
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError)
        throw new ProblemError("revision_conflict");
      throw error;
    }
  }
}
