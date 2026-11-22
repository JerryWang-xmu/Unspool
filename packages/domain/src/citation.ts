import { integer, object, text, timestamp } from "./validation.js";

/**
 * A citation names the exact source revision shown in the recipient's filtered
 * preparation context. It never grants access to a source the recipient could
 * not read.
 */
export interface Citation {
  readonly privateQAId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly recordedAt: string;
}

export interface CreateCitationInput {
  readonly privateQAId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly recordedAt: string;
}

export function parseCitation(value: unknown): Citation {
  const input = object(value, "Citation");
  return Object.freeze({
    privateQAId: text(input.privateQAId, "Citation.privateQAId"),
    sourceType: text(input.sourceType, "Citation.sourceType"),
    sourceId: text(input.sourceId, "Citation.sourceId"),
    sourceRevision: integer(input.sourceRevision, "Citation.sourceRevision"),
    recordedAt: timestamp(input.recordedAt, "Citation.recordedAt"),
  });
}

export function createCitation(input: CreateCitationInput): Citation {
  return parseCitation(input);
}
