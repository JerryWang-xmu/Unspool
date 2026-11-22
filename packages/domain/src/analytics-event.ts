import { object, optionalText, text, timestamp } from "./validation.js";

export type AnalyticsMetadataValue = string | number | boolean | null;
export type AnalyticsMetadata = Readonly<Record<string, AnalyticsMetadataValue>>;

/**
 * Behavioral metadata only. Instructions, discussions, files, paths, tool
 * parameters, model output and private Q&A bodies are excluded from analytics;
 * they belong to the separate security audit, if at all.
 */
export const FORBIDDEN_ANALYTICS_METADATA_KEYS = [
  "body",
  "content",
  "text",
  "message",
  "prompt",
  "instruction",
  "discussion",
  "question",
  "answer",
  "privateqa",
  "file",
  "filename",
  "path",
  "args",
  "arguments",
  "parameters",
  "outbound",
  "payload",
  "transcript",
] as const;

const FORBIDDEN_METADATA_KEYS = new Set<string>(FORBIDDEN_ANALYTICS_METADATA_KEYS);
const FORBIDDEN_METADATA_SUFFIXES = ["body", "content"] as const;
const MAX_METADATA_STRING_LENGTH = 256;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertAnalyticsMetadata(
  metadata: Readonly<Record<string, unknown>>,
): asserts metadata is AnalyticsMetadata {
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = normalizedKey(key);
    if (
      FORBIDDEN_METADATA_KEYS.has(normalized) ||
      FORBIDDEN_METADATA_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    ) {
      throw new RangeError(`AnalyticsEvent.metadata must not contain content field: ${key}`);
    }
    if (value === null) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new TypeError(`AnalyticsEvent.metadata.${key} must be a flat scalar value`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`AnalyticsEvent.metadata.${key} must be finite`);
    }
    if (typeof value === "string" && value.length > MAX_METADATA_STRING_LENGTH) {
      throw new RangeError(
        `AnalyticsEvent.metadata.${key} must be at most ${MAX_METADATA_STRING_LENGTH} characters`,
      );
    }
  }
}

export interface AnalyticsEvent {
  readonly eventName: string;
  readonly occurredAt: string;
  readonly actorPseudonym?: string;
  readonly workspacePseudonym?: string;
  readonly metadata: AnalyticsMetadata;
}

export interface CreateAnalyticsEventInput {
  readonly eventName: string;
  readonly occurredAt: string;
  readonly actorPseudonym?: string;
  readonly workspacePseudonym?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function createAnalyticsEvent(input: CreateAnalyticsEventInput): AnalyticsEvent {
  const metadata = object(input.metadata, "AnalyticsEvent.metadata");
  assertAnalyticsMetadata(metadata);
  const actorPseudonym = optionalText(input.actorPseudonym, "AnalyticsEvent.actorPseudonym");
  const workspacePseudonym = optionalText(
    input.workspacePseudonym,
    "AnalyticsEvent.workspacePseudonym",
  );

  return Object.freeze({
    eventName: text(input.eventName, "AnalyticsEvent.eventName"),
    occurredAt: timestamp(input.occurredAt, "AnalyticsEvent.occurredAt"),
    ...(actorPseudonym === undefined ? {} : { actorPseudonym }),
    ...(workspacePseudonym === undefined ? {} : { workspacePseudonym }),
    metadata: Object.freeze({ ...metadata }),
  });
}
