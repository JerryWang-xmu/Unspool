import { text, textArray, timestamp } from "./validation.js";

/**
 * The personal workspace and its pi session remain private; conversion only
 * copies the selected records into a new shared workspace. `sourceRunStoppedAt`
 * is required evidence that an active personal Run was stopped first.
 */
export interface ShareConversion {
  readonly id: string;
  readonly sourceWorkspaceId: string;
  readonly targetWorkspaceId: string;
  readonly selectedRecordIds: readonly string[];
  readonly sourceRunStoppedAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateShareConversionInput {
  readonly id: string;
  readonly sourceWorkspaceId: string;
  readonly targetWorkspaceId: string;
  readonly selectedRecordIds: readonly string[];
  readonly sourceRunStoppedAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export function createShareConversion(input: CreateShareConversionInput): ShareConversion {
  const sourceWorkspaceId = text(input.sourceWorkspaceId, "ShareConversion.sourceWorkspaceId");
  const targetWorkspaceId = text(input.targetWorkspaceId, "ShareConversion.targetWorkspaceId");
  if (sourceWorkspaceId === targetWorkspaceId) {
    throw new RangeError("ShareConversion must create a new shared workspace");
  }

  const selectedRecordIds = textArray(input.selectedRecordIds, "ShareConversion.selectedRecordIds");
  if (selectedRecordIds.length === 0) {
    throw new RangeError("ShareConversion.selectedRecordIds must contain at least one record");
  }
  if (new Set(selectedRecordIds).size !== selectedRecordIds.length) {
    throw new RangeError("ShareConversion.selectedRecordIds must not contain duplicates");
  }

  const sourceRunStoppedAt = timestamp(
    input.sourceRunStoppedAt,
    "ShareConversion.sourceRunStoppedAt",
  );
  const createdAt = timestamp(input.createdAt, "ShareConversion.createdAt");
  if (Date.parse(sourceRunStoppedAt) > Date.parse(createdAt)) {
    throw new RangeError("sourceRunStoppedAt cannot be later than createdAt");
  }

  return Object.freeze({
    id: text(input.id, "ShareConversion.id"),
    sourceWorkspaceId,
    targetWorkspaceId,
    selectedRecordIds: Object.freeze([...selectedRecordIds]),
    sourceRunStoppedAt,
    createdBy: text(input.createdBy, "ShareConversion.createdBy"),
    createdAt,
  });
}
