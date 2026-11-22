import { createHash, randomBytes } from "node:crypto";
import type { SqliteDatabase, SqliteTransaction } from "./database.js";

export interface CommandEvent {
  readonly eventId?: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly occurredAt: string;
  readonly actorId?: string;
  readonly runId?: string;
  readonly visibility: unknown;
  readonly payloadRef?: string | null;
  readonly payloadDigest: string;
  readonly payload?: unknown;
}

export interface CommandUnitOfWork<TResponse = unknown> {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly response: TResponse;
  readonly mutate: (transaction: SqliteTransaction) => void | Promise<void>;
  readonly events?: readonly CommandEvent[];
}

export interface CommandCommitResult<TResponse = unknown> {
  readonly replayed: boolean;
  readonly response: TResponse;
  readonly eventIds: string[];
  readonly outboxMessageIds: string[];
}

export class CommandRevisionConflictError extends Error {
  readonly code = "revision_conflict";
  readonly commandId: string;
  readonly actorId: string;

  constructor(commandId: string, actorId: string) {
    super(
      `Command ${commandId} was already accepted by ${actorId} with a different payload digest.`,
    );
    this.name = "CommandRevisionConflictError";
    this.commandId = commandId;
    this.actorId = actorId;
  }
}

interface CommandReceiptRow {
  payload_digest: string;
  response: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function jsonDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function commitCommandUnitOfWork<TResponse>(
  database: SqliteDatabase,
  command: CommandUnitOfWork<TResponse>,
): Promise<CommandCommitResult<TResponse>> {
  return database.write(async (transaction) => {
    const existing = await transaction.query<CommandReceiptRow>(
      `SELECT payload_digest, response
         FROM command_receipt
        WHERE actor_id = ? AND command_id = ?`,
      [command.actorId, command.commandId],
    );

    if (existing.length > 0) {
      const receipt = existing[0];
      if (!receipt || receipt.payload_digest !== command.payloadDigest) {
        throw new CommandRevisionConflictError(command.commandId, command.actorId);
      }
      return {
        replayed: true,
        response: JSON.parse(receipt.response) as TResponse,
        eventIds: [],
        outboxMessageIds: [],
      };
    }

    await command.mutate(transaction);

    const sequenceRow = await transaction.query<{ next_sequence: number }>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM domain_event
        WHERE workspace_id = ?`,
      [command.workspaceId],
    );
    let sequence = Number(sequenceRow[0]?.next_sequence ?? 1);

    const eventIds: string[] = [];
    const outboxMessageIds: string[] = [];
    const acceptedAt = new Date().toISOString();

    for (const event of command.events ?? []) {
      const eventId = event.eventId ?? uuidv7();
      await transaction.execute(
        `INSERT INTO domain_event (
           id, workspace_id, sequence, schema_version, type, actor_id, run_id,
           occurred_at, visibility, payload_ref, payload_digest, payload
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          command.workspaceId,
          sequence,
          event.schemaVersion,
          event.type,
          event.actorId ?? command.actorId,
          event.runId ?? null,
          event.occurredAt,
          JSON.stringify(event.visibility),
          event.payloadRef ?? `event:${eventId}`,
          event.payloadDigest,
          JSON.stringify(event.payload ?? null),
        ],
      );
      eventIds.push(eventId);

      const outboxMessageId = uuidv7();
      await transaction.execute(
        `INSERT INTO outbox_message (
           id, domain_event_id, destination, state, attempt_count, available_at, created_at
         ) VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
        [outboxMessageId, eventId, "domain-events", event.occurredAt, acceptedAt],
      );
      outboxMessageIds.push(outboxMessageId);
      sequence += 1;
    }

    await transaction.execute(
      `INSERT INTO command_receipt (
         actor_id, workspace_id, command_id, payload_digest, response_digest, accepted_at, response
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        command.actorId,
        command.workspaceId,
        command.commandId,
        command.payloadDigest,
        jsonDigest(command.response),
        acceptedAt,
        JSON.stringify(command.response),
      ],
    );

    return {
      replayed: false,
      response: command.response,
      eventIds,
      outboxMessageIds,
    };
  });
}
