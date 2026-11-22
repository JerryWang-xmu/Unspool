const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuidV7 = (value: unknown): value is string =>
  typeof value === "string" && UUID_V7_PATTERN.test(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && RFC3339_UTC_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

export const COMPLETION_RESULTS = [
  "complete",
  "partial",
  "incomplete",
  "failed",
  "cancelled",
] as const;
export type CompletionResult = (typeof COMPLETION_RESULTS)[number];

/**
 * A human completion decision. Agent output is not an assessment; record this
 * only with an authenticated human assessor.
 */
export interface CompletionAssessment {
  readonly runId: string;
  readonly result: CompletionResult;
  readonly reason?: string;
  readonly assessedBy: string;
  readonly assessedAt: string;
  readonly evidenceExceptionId?: string;
}

export function parseCompletionAssessment(value: unknown): CompletionAssessment {
  if (!isRecord(value)) {
    throw new TypeError("CompletionAssessment must be an object");
  }

  const { runId, result, assessedBy, assessedAt, evidenceExceptionId } = value;
  if (!isUuidV7(runId)) {
    throw new TypeError("CompletionAssessment.runId must be a UUIDv7 string");
  }
  if (!isOneOf(result, COMPLETION_RESULTS)) {
    throw new TypeError("CompletionAssessment.result is not a supported completion result");
  }

  let reason: string | undefined;
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
      throw new TypeError("CompletionAssessment.reason must be a non-empty string");
    }
    reason = value.reason;
  }

  if (!isUuidV7(assessedBy)) {
    throw new TypeError("CompletionAssessment.assessedBy must be a UUIDv7 string");
  }
  if (!isTimestamp(assessedAt)) {
    throw new TypeError("CompletionAssessment.assessedAt must be an RFC 3339 UTC timestamp");
  }
  if (evidenceExceptionId !== undefined && !isUuidV7(evidenceExceptionId)) {
    throw new TypeError("CompletionAssessment.evidenceExceptionId must be a UUIDv7 string");
  }

  return Object.freeze({
    runId,
    result,
    assessedBy,
    assessedAt,
    ...(reason === undefined ? {} : { reason }),
    ...(evidenceExceptionId === undefined ? {} : { evidenceExceptionId }),
  });
}
