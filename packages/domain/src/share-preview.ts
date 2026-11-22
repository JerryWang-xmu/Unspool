import { text, textArray, timestamp } from "./validation.js";

/**
 * Private categories that must be excluded unless a future policy explicitly
 * allows them. Unselected content is part of the default so an empty selection
 * can never widen the share silently.
 */
export const DEFAULT_SHARE_EXCLUDED_CATEGORIES = [
  "credentials",
  "preferences",
  "drafts",
  "private_qa",
  "unselected",
] as const;

export interface SharePreview {
  readonly id: string;
  readonly sourceWorkspaceId: string;
  readonly selectedRecordIds: readonly string[];
  readonly excludedCategories: readonly string[];
  readonly createdBy: string;
  readonly expiresAt: string;
}

export interface CreateSharePreviewInput {
  readonly id: string;
  readonly sourceWorkspaceId: string;
  readonly selectedRecordIds: readonly string[];
  readonly excludedCategories?: readonly string[];
  readonly createdBy: string;
  readonly expiresAt: string;
}

function uniqueNonEmpty(values: readonly string[], name: string): readonly string[] {
  if (values.length === 0) {
    throw new RangeError(`${name} must contain at least one record`);
  }
  if (new Set(values).size !== values.length) {
    throw new RangeError(`${name} must not contain duplicates`);
  }
  return values;
}

/**
 * Sharing is opt-in: callers must select records explicitly, and omitted
 * private categories are added to `excludedCategories` rather than dropped.
 */
export function createSharePreview(input: CreateSharePreviewInput): SharePreview {
  const selectedRecordIds = uniqueNonEmpty(
    textArray(input.selectedRecordIds, "SharePreview.selectedRecordIds"),
    "SharePreview.selectedRecordIds",
  );
  const extraExcluded =
    input.excludedCategories === undefined
      ? []
      : textArray(input.excludedCategories, "SharePreview.excludedCategories");
  const excludedCategories = [
    ...new Set<string>([...DEFAULT_SHARE_EXCLUDED_CATEGORIES, ...extraExcluded]),
  ];

  return Object.freeze({
    id: text(input.id, "SharePreview.id"),
    sourceWorkspaceId: text(input.sourceWorkspaceId, "SharePreview.sourceWorkspaceId"),
    selectedRecordIds: Object.freeze([...selectedRecordIds]),
    excludedCategories: Object.freeze(excludedCategories),
    createdBy: text(input.createdBy, "SharePreview.createdBy"),
    expiresAt: timestamp(input.expiresAt, "SharePreview.expiresAt"),
  });
}

/** Authorization intervals are half-open: `now >= expiresAt` is expired. */
export function isSharePreviewExpired(preview: SharePreview, now: string): boolean {
  return Date.parse(timestamp(now, "now")) >= Date.parse(preview.expiresAt);
}
