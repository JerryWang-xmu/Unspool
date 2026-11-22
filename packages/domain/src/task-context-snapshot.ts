const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuidV7 = (value: unknown): value is string =>
  typeof value === "string" && UUID_V7_PATTERN.test(value);

const isSha256Digest = (value: unknown): value is string =>
  typeof value === "string" && SHA256_DIGEST_PATTERN.test(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && RFC3339_UTC_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

export interface TaskContextSnapshot {
  readonly id: string;
  readonly runId: string;
  readonly contextVersionIds: readonly string[];
  readonly renderedDigest: string;
  readonly createdAt: string;
}

export function parseTaskContextSnapshot(value: unknown): TaskContextSnapshot {
  if (!isRecord(value)) {
    throw new TypeError("TaskContextSnapshot must be an object");
  }

  const { id, runId, contextVersionIds, renderedDigest, createdAt } = value;
  if (!isUuidV7(id)) {
    throw new TypeError("TaskContextSnapshot.id must be a UUIDv7 string");
  }
  if (!isUuidV7(runId)) {
    throw new TypeError("TaskContextSnapshot.runId must be a UUIDv7 string");
  }
  if (
    !Array.isArray(contextVersionIds) ||
    !contextVersionIds.every((versionId) => isUuidV7(versionId))
  ) {
    throw new TypeError("TaskContextSnapshot.contextVersionIds must be an array of UUIDv7 strings");
  }
  if (new Set(contextVersionIds).size !== contextVersionIds.length) {
    throw new TypeError("TaskContextSnapshot.contextVersionIds must not contain duplicates");
  }
  if (!isSha256Digest(renderedDigest)) {
    throw new TypeError("TaskContextSnapshot.renderedDigest must be a SHA-256 digest");
  }
  if (!isTimestamp(createdAt)) {
    throw new TypeError("TaskContextSnapshot.createdAt must be an RFC 3339 UTC timestamp");
  }

  return Object.freeze({
    id,
    runId,
    contextVersionIds: Object.freeze([...contextVersionIds] as string[]),
    renderedDigest,
    createdAt,
  });
}
