import type { CommittedEvent } from "./service.js";

/** Contract heartbeat interval for the workspace event stream. */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export interface LastEventId {
  readonly workspaceId: string;
  readonly sequence: number;
}

export interface ReconnectCursorInput {
  readonly workspaceId: string;
  readonly lastEventId?: string | null;
  readonly after?: number | null;
}

function assertSseEvent(event: CommittedEvent): void {
  if (typeof event.workspaceId !== "string" || event.workspaceId.length === 0) {
    throw new TypeError("SSE DomainEvent workspaceId must be a non-empty string.");
  }
  if (/[\r\n]/.test(event.workspaceId)) {
    throw new TypeError("SSE DomainEvent workspaceId must not contain line breaks.");
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
    throw new TypeError("SSE DomainEvent sequence must be a positive safe integer.");
  }
  if (typeof event.type !== "string" || event.type.length === 0) {
    throw new TypeError("SSE DomainEvent type must be a non-empty string.");
  }
  if (/[\r\n]/.test(event.type)) {
    throw new TypeError("SSE DomainEvent type must not contain line breaks.");
  }
}

/**
 * Formats one complete, permission-filtered DomainEvent as an SSE frame.
 * The id is `<workspaceId>:<sequence>`, the event name is the DomainEvent
 * type, and data is the unchanged JSON envelope.
 */
export function formatSseEvent<TEvent extends CommittedEvent>(event: TEvent): string {
  assertSseEvent(event);

  const serialized = JSON.stringify(event);
  if (serialized === undefined) {
    throw new TypeError("SSE DomainEvent must be JSON serializable.");
  }

  const dataLines = serialized
    .split(/\r?\n/)
    .map((line) => `data: ${line}`)
    .join("\n");

  return `id: ${event.workspaceId}:${event.sequence}\nevent: ${event.type}\n${dataLines}\n\n`;
}

/** A business-data-free SSE comment used to keep idle connections open. */
export function heartbeatFrame(): string {
  return ": heartbeat\n\n";
}

/**
 * Parses the contract's `<workspaceId>:<sequence>` cursor. Invalid cursors are
 * rejected at the transport boundary instead of silently restarting at zero.
 */
export function parseLastEventId(value: string): LastEventId {
  if (typeof value !== "string") {
    throw new TypeError("Last-Event-ID must be a string.");
  }

  const normalized = value.trim();
  const separator = normalized.lastIndexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new TypeError(
      `Invalid Last-Event-ID "${value}"; expected <workspaceId>:<positive sequence>.`,
    );
  }

  const workspaceId = normalized.slice(0, separator);
  const sequenceText = normalized.slice(separator + 1);
  if (workspaceId.trim() !== workspaceId || /\s/.test(workspaceId)) {
    throw new TypeError(`Invalid Last-Event-ID "${value}": malformed workspace id.`);
  }
  if (!/^[1-9]\d*$/.test(sequenceText)) {
    throw new TypeError(
      `Invalid Last-Event-ID "${value}"; expected <workspaceId>:<positive sequence>.`,
    );
  }

  const sequence = Number(sequenceText);
  if (!Number.isSafeInteger(sequence)) {
    throw new TypeError(`Invalid Last-Event-ID "${value}": sequence is out of range.`);
  }

  return { workspaceId, sequence };
}

/**
 * Resolves the replay cursor for a reconnect. A `Last-Event-ID` header wins
 * over the legacy `after` query parameter because it records what the client
 * actually received; both forms are validated before any replay query runs.
 */
export function resolveReconnectSequence(input: ReconnectCursorInput): number {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    throw new TypeError("Reconnect workspaceId must be a non-empty string.");
  }

  if (input.lastEventId !== undefined && input.lastEventId !== null) {
    const cursor = parseLastEventId(input.lastEventId);
    if (cursor.workspaceId !== input.workspaceId) {
      throw new TypeError("Last-Event-ID does not belong to the requested workspace.");
    }
    return cursor.sequence;
  }

  const after = input.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) {
    throw new RangeError("after must be a non-negative safe integer.");
  }
  return after;
}
