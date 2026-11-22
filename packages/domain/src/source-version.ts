import { integer, object, optionalText, text, timestamp } from "./validation.js";
export interface SourceVersion {
  id: string;
  sourceId: string;
  version: number;
  contentRef: string;
  contentDigest: string;
  recordedAt: string;
  supersedesId?: string | undefined;
}
export function parseSourceVersion(value: unknown): SourceVersion {
  const input = object(value, "SourceVersion");
  const supersedesId = optionalText(input.supersedesId, "SourceVersion.supersedesId");
  if (supersedesId === input.id) throw new RangeError("SourceVersion cannot supersede itself");
  return Object.freeze({
    id: text(input.id, "SourceVersion.id"),
    sourceId: text(input.sourceId, "SourceVersion.sourceId"),
    version: integer(input.version, "SourceVersion.version", 1),
    contentRef: text(input.contentRef, "SourceVersion.contentRef"),
    contentDigest: text(input.contentDigest, "SourceVersion.contentDigest"),
    recordedAt: timestamp(input.recordedAt, "SourceVersion.recordedAt"),
    ...(supersedesId === undefined ? {} : { supersedesId }),
  });
}
export function createSourceVersion(input: SourceVersion): SourceVersion {
  return parseSourceVersion(input);
}
