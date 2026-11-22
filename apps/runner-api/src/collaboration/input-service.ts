import {
  INPUT_ITEM_KINDS,
  type InputItemKind,
} from "../../../../packages/domain/src/input-item.js";
import {
  SUGGESTION_DECISION_STATUSES,
  type SuggestionDecisionStatus,
} from "../../../../packages/domain/src/suggestion-decision.js";
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
import {
  type ActorAttributionSnapshot,
  assertCanContribute,
  assertOperatorAuthority,
  assertWorkspaceWritable,
  loadWorkspaceAccess,
  resolveActorAttribution,
} from "../workspaces/service.js";

export interface InputServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface InputCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

export interface InputItemView {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: InputItemKind;
  readonly body: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly references: string[];
  readonly status: SuggestionDecisionStatus | null;
  readonly suggestedBy: string;
  readonly decidedBy: string | null;
  readonly editedBody: string | null;
  readonly resultingInputId: string | null;
  readonly decidedAt: string | null;
  readonly resultingInput: ResultingInputView | null;
  readonly attribution: ActorAttributionSnapshot | null;
}

export interface ResultingInputView {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: InputItemKind;
  readonly body: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly references: string[];
}

export interface PostInputCommand {
  readonly body: string;
  readonly references?: readonly string[] | undefined;
  readonly payloadDigest: string;
}

export interface DecideSuggestionCommand {
  readonly decision: string;
  readonly editedBody?: string | undefined;
  readonly payloadDigest: string;
}

export interface SuggestionMutationResult {
  readonly suggestion: InputItemView;
  readonly resultingInput: ResultingInputView | null;
}

export interface SuggestionListResult {
  readonly suggestions: InputItemView[];
}

interface InputRow {
  id: string;
  workspaceId: string;
  kind: InputItemKind;
  body: string;
  authorId: string;
  createdAt: string;
  references: string;
  decisionStatus: SuggestionDecisionStatus | null;
  suggestedBy: string | null;
  decidedBy: string | null;
  editedBody: string | null;
  decidedAt: string | null;
  resultingInputId: string | null;
  resultingInputWorkspaceId: string | null;
  resultingInputKind: InputItemKind | null;
  resultingInputBody: string | null;
  resultingInputAuthorId: string | null;
  resultingInputCreatedAt: string | null;
  resultingInputReferences: string | null;
}

const INPUT_SELECT = `
  SELECT i.id, i.workspace_id AS workspaceId, i.kind, i.body, i.author_id AS authorId,
         i.created_at AS createdAt, i."references" AS referenceJson,
         sd.status AS decisionStatus, sd.suggested_by AS suggestedBy,
         sd.decided_by AS decidedBy, sd.edited_body AS editedBody,
         sd.decided_at AS decidedAt, sd.resulting_input_id AS resultingInputId,
         ri.workspace_id AS resultingInputWorkspaceId, ri.kind AS resultingInputKind,
         ri.body AS resultingInputBody, ri.author_id AS resultingInputAuthorId,
         ri.created_at AS resultingInputCreatedAt, ri."references" AS resultingInputReferences
    FROM input_item i
    LEFT JOIN suggestion_decision sd ON sd.suggestion_id = i.id
    LEFT JOIN input_item ri ON ri.id = sd.resulting_input_id
`;

function requiredText(value: unknown, field: string, maxLength = 100_000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ProblemError("invalid_request", {
      detail: `${field} is required and must be within its length limit.`,
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

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new ProblemError("invalid_request", {
      detail: "references must be an array of strings.",
    });
  }
  return [...value];
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // A malformed stored array is treated as empty rather than failing reads.
  }
  return [];
}

function isSuggestionDecision(value: unknown): value is SuggestionDecisionStatus {
  return (
    typeof value === "string" && (SUGGESTION_DECISION_STATUSES as readonly string[]).includes(value)
  );
}

function isInputKind(value: unknown): value is InputItemKind {
  return typeof value === "string" && (INPUT_ITEM_KINDS as readonly string[]).includes(value);
}

function resultingInputView(row: InputRow): ResultingInputView | null {
  if (row.resultingInputId === null || row.resultingInputKind === null) return null;
  return {
    id: String(row.resultingInputId),
    workspaceId: String(row.resultingInputWorkspaceId),
    kind: row.resultingInputKind,
    body: String(row.resultingInputBody),
    authorId: String(row.resultingInputAuthorId),
    createdAt: String(row.resultingInputCreatedAt),
    references: parseStringArray(row.resultingInputReferences),
  };
}

function inputView(row: InputRow): InputItemView {
  const kind = row.kind;
  const status = kind === "suggestion" ? (row.decisionStatus ?? "pending") : null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    kind,
    body: String(row.body),
    authorId: String(row.authorId),
    createdAt: String(row.createdAt),
    references: parseStringArray(row.references),
    status,
    suggestedBy: String(row.suggestedBy ?? row.authorId),
    decidedBy: row.decidedBy === null ? null : String(row.decidedBy),
    editedBody: row.editedBody === null ? null : String(row.editedBody),
    resultingInputId: row.resultingInputId === null ? null : String(row.resultingInputId),
    decidedAt: row.decidedAt === null ? null : String(row.decidedAt),
    resultingInput: resultingInputView(row),
    attribution: null,
  };
}

function inputRowFromInsert(input: {
  id: string;
  workspaceId: string;
  kind: InputItemKind;
  body: string;
  authorId: string;
  createdAt: string;
  references: string[];
}): InputRow {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    kind: input.kind,
    body: input.body,
    authorId: input.authorId,
    createdAt: input.createdAt,
    references: JSON.stringify(input.references),
    decisionStatus: input.kind === "suggestion" ? "pending" : null,
    suggestedBy: input.kind === "suggestion" ? input.authorId : null,
    decidedBy: null,
    editedBody: null,
    decidedAt: null,
    resultingInputId: null,
    resultingInputWorkspaceId: null,
    resultingInputKind: null,
    resultingInputBody: null,
    resultingInputAuthorId: null,
    resultingInputCreatedAt: null,
    resultingInputReferences: null,
  };
}

function assertInputKind(value: string): InputItemKind {
  if (!isInputKind(value)) {
    throw new ProblemError("invalid_request", { detail: "Unsupported input kind." });
  }
  return value;
}

export class InputService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: InputServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
  }

  async postDiscussion(
    actorId: string,
    workspaceId: string,
    input: PostInputCommand,
    commandId: string,
  ): Promise<InputCommandResult<{ input: InputItemView }>> {
    return this.#postInput(actorId, workspaceId, "discussion", input, commandId);
  }

  async postSuggestion(
    actorId: string,
    workspaceId: string,
    input: PostInputCommand,
    commandId: string,
  ): Promise<InputCommandResult<{ input: InputItemView }>> {
    return this.#postInput(actorId, workspaceId, "suggestion", input, commandId);
  }

  /**
   * Records an explicit operator instruction. It never opens a Run by itself;
   * Run start/steer remains a separate command with its own operator-epoch
   * preconditions.
   */
  async postDirectInstruction(
    actorId: string,
    workspaceId: string,
    input: PostInputCommand,
    commandId: string,
  ): Promise<InputCommandResult<{ input: InputItemView }>> {
    return this.#postInput(actorId, workspaceId, "agent_instruction", input, commandId);
  }

  async listInputs(
    actorId: string,
    workspaceId: string,
    kind?: InputItemKind,
  ): Promise<{ inputs: InputItemView[] }> {
    await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    const rows = await this.#database.query<InputRow>(
      `${INPUT_SELECT}
        WHERE i.workspace_id = ?
          ${kind === undefined ? "" : "AND i.kind = ?"}
        ORDER BY i.created_at DESC`,
      kind === undefined ? [workspaceId] : [workspaceId, assertInputKind(kind)],
    );
    return { inputs: rows.map(inputView) };
  }

  async listSuggestions(actorId: string, workspaceId: string): Promise<SuggestionListResult> {
    const { inputs } = await this.listInputs(actorId, workspaceId, "suggestion");
    return { suggestions: inputs };
  }

  async getSuggestion(
    actorId: string,
    workspaceId: string,
    suggestionId: string,
  ): Promise<SuggestionMutationResult> {
    await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    const row = await this.#loadInput(this.#database, workspaceId, suggestionId);
    if (row === null || row.kind !== "suggestion") throw new ProblemError("not_found");
    return {
      suggestion: inputView(row),
      resultingInput: resultingInputView(row),
    };
  }

  async decideSuggestion(
    actorId: string,
    workspaceId: string,
    suggestionId: string,
    input: DecideSuggestionCommand,
    commandId: string,
  ): Promise<InputCommandResult<SuggestionMutationResult>> {
    if (!isSuggestionDecision(input.decision)) {
      throw new ProblemError("invalid_request", { detail: "Unsupported suggestion decision." });
    }
    const decision = input.decision;
    const editedBody =
      decision === "edited_adopted"
        ? requiredText(input.editedBody, "editedBody", 100_000)
        : input.editedBody === undefined
          ? null
          : requiredText(input.editedBody, "editedBody", 100_000);
    const payloadDigest = requiredDigest(input.payloadDigest);
    const now = this.#now().toISOString();
    const response: {
      suggestion: InputItemView | null;
      resultingInput: ResultingInputView | null;
    } = { suggestion: null, resultingInput: null };

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
          const row = await this.#loadInput(transaction, workspaceId, suggestionId);
          if (row === null || row.kind !== "suggestion") throw new ProblemError("not_found");

          const existing = await transaction.query<{ status: string }>(
            "SELECT status FROM suggestion_decision WHERE suggestion_id = ?",
            [suggestionId],
          );
          if (existing.length > 0) {
            throw new ProblemError("invalid_request", {
              detail: "A suggestion decision is immutable once recorded.",
            });
          }

          const resultingInputId =
            decision === "adopted" || decision === "edited_adopted" ? this.#newId() : null;
          if (resultingInputId !== null) {
            await transaction.execute(
              `INSERT INTO input_item (id, workspace_id, kind, body, author_id, created_at, "references")
               VALUES (?, ?, 'agent_instruction', ?, ?, ?, ?)`,
              [
                resultingInputId,
                workspaceId,
                decision === "edited_adopted" && editedBody !== null ? editedBody : row.body,
                actorId,
                now,
                JSON.stringify([suggestionId]),
              ],
            );
          }

          await transaction.execute(
            `INSERT INTO suggestion_decision
               (suggestion_id, status, suggested_by, decided_by, edited_body, resulting_input_id, decided_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              suggestionId,
              decision,
              row.authorId,
              actorId,
              decision === "edited_adopted" ? editedBody : null,
              resultingInputId,
              now,
            ],
          );

          const updatedRow = await this.#loadInput(transaction, workspaceId, suggestionId);
          if (updatedRow === null) throw new ProblemError("internal_error");
          const attribution = await resolveActorAttribution(transaction, access, actorId, now);
          const suggestion = inputView(updatedRow);
          response.suggestion = { ...suggestion, attribution };
          response.resultingInput = resultingInputView(updatedRow);
          if (resultingInputId !== null && response.resultingInput !== null) {
            response.suggestion = {
              ...response.suggestion,
              resultingInput: response.resultingInput,
            };
          }
        },
        events: [
          {
            type: "input.suggestion_decided",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: {
              suggestionId,
              decision,
              suggestedBy: response.suggestion?.suggestedBy ?? null,
              decidedBy: actorId,
              resultingInputId: response.resultingInput?.id ?? null,
            },
          },
        ],
      });
      if (result.response.suggestion === null) throw new ProblemError("internal_error");
      return {
        response: {
          suggestion: result.response.suggestion,
          resultingInput: result.response.resultingInput,
        },
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async #postInput(
    actorId: string,
    workspaceId: string,
    kind: InputItemKind,
    input: PostInputCommand,
    commandId: string,
  ): Promise<InputCommandResult<{ input: InputItemView }>> {
    const body = requiredText(input.body, "body");
    const references = stringArray(input.references);
    const payloadDigest = requiredDigest(input.payloadDigest);
    const id = this.#newId();
    const now = this.#now().toISOString();
    const response: { input: InputItemView | null } = { input: null };

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
          if (kind === "agent_instruction") {
            assertOperatorAuthority(access);
          } else {
            assertCanContribute(access);
          }
          const attribution = await resolveActorAttribution(transaction, access, actorId, now);
          await transaction.execute(
            `INSERT INTO input_item
               (id, workspace_id, kind, body, author_id, created_at, "references")
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, workspaceId, kind, body, actorId, now, JSON.stringify(references)],
          );
          response.input = {
            ...inputView(
              inputRowFromInsert({
                id,
                workspaceId,
                kind,
                body,
                authorId: actorId,
                createdAt: now,
                references,
              }),
            ),
            attribution,
          };
        },
        events: [
          {
            type: `input.${kind}_posted`,
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { inputId: id, kind, body, authorId: actorId },
          },
        ],
      });
      if (result.response.input === null) throw new ProblemError("internal_error");
      return { response: { input: result.response.input }, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError) {
        throw new ProblemError("revision_conflict");
      }
      throw error;
    }
  }

  async #loadInput(
    executor: SqliteTransaction,
    workspaceId: string,
    inputId: string,
  ): Promise<InputRow | null> {
    const rows = await executor.query<InputRow>(
      `${INPUT_SELECT} WHERE i.workspace_id = ? AND i.id = ?`,
      [workspaceId, inputId],
    );
    return rows[0] ?? null;
  }
}

export function createInputService(options: InputServiceOptions): InputService {
  return new InputService(options);
}
