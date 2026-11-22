import type { Attribution } from "../../contracts/src/attribution.js";
import { parseAttribution } from "../../contracts/src/attribution.js";
import { integer, object, optionalText, text } from "./validation.js";

export const ARTIFACT_KINDS = [
  "reference",
  "agent_output",
  "node_artifact",
  "patch",
  "export",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const DEFAULT_ARTIFACT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export interface ArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  blobId: string;
  kind: ArtifactKind;
  originType: string;
  originId: string;
  runId?: string | undefined;
  attribution: Attribution;
  securityLabelId: string;
  sourceSummary: string;
}

export function parseArtifactVersion(value: unknown): ArtifactVersion {
  const input = object(value, "ArtifactVersion");
  const kind = text(input.kind, "ArtifactVersion.kind") as ArtifactKind;
  if (!ARTIFACT_KINDS.includes(kind))
    throw new TypeError(`Unsupported ArtifactVersion.kind: ${kind}`);
  return {
    id: text(input.id, "ArtifactVersion.id"),
    artifactId: text(input.artifactId, "ArtifactVersion.artifactId"),
    version: integer(input.version, "ArtifactVersion.version", 1),
    blobId: text(input.blobId, "ArtifactVersion.blobId"),
    kind,
    originType: text(input.originType, "ArtifactVersion.originType"),
    originId: text(input.originId, "ArtifactVersion.originId"),
    runId: optionalText(input.runId, "ArtifactVersion.runId"),
    attribution: parseAttribution(input.attribution),
    securityLabelId: text(input.securityLabelId, "ArtifactVersion.securityLabelId"),
    sourceSummary: text(input.sourceSummary, "ArtifactVersion.sourceSummary"),
  };
}

export function assertArtifactSizeAllowed(
  size: number,
  limit = DEFAULT_ARTIFACT_UPLOAD_LIMIT_BYTES,
): void {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new TypeError("artifact size must be a non-negative safe integer");
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new TypeError("artifact limit must be positive");
  if (size > limit)
    throw new RangeError(`artifact size ${size} exceeds the configured limit ${limit}`);
}
