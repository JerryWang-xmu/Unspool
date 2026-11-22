export const COMMAND_SCHEMA_VERSION = 1;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface CommandEnvelope {
  readonly schemaVersion?: number;
  readonly commandId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly payloadDigest: string;
  readonly kind?: string;
  readonly expectedRevision?: number;
  readonly [key: string]: unknown;
}

export interface CommandReplayReceipt {
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly response: unknown;
  readonly [key: string]: unknown;
}

export type CommandReplayDecision = "accept" | "replay" | "conflict";

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Command envelope ${field} must be a non-empty string.`);
  }
}

export function assertCommandEnvelope(envelope: unknown): asserts envelope is CommandEnvelope {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("Command envelope must be an object.");
  }

  const candidate = envelope as Record<string, unknown>;
  requireNonEmptyString(candidate.commandId, "commandId");
  requireNonEmptyString(candidate.actorId, "actorId");
  requireNonEmptyString(candidate.workspaceId, "workspaceId");

  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== COMMAND_SCHEMA_VERSION) {
    throw new TypeError(
      `Command envelope schemaVersion must be ${COMMAND_SCHEMA_VERSION}: ${String(candidate.schemaVersion)}`,
    );
  }

  if (
    typeof candidate.payloadDigest !== "string" ||
    !DIGEST_PATTERN.test(candidate.payloadDigest)
  ) {
    throw new TypeError("Command envelope payloadDigest must match sha256:<64 lowercase hex>.");
  }

  if (candidate.kind !== undefined) {
    requireNonEmptyString(candidate.kind, "kind");
  }
}

export function evaluateCommandReplay(
  existingReceipt: CommandReplayReceipt | undefined,
  incomingEnvelope: CommandEnvelope,
): CommandReplayDecision {
  assertCommandEnvelope(incomingEnvelope);

  if (existingReceipt === undefined) return "accept";
  if (existingReceipt.commandId !== incomingEnvelope.commandId) return "conflict";
  if (existingReceipt.payloadDigest !== incomingEnvelope.payloadDigest) return "conflict";
  return "replay";
}
