export const CONTEXT_KINDS = [
  "goal",
  "fact",
  "decision",
  "constraint",
  "todo",
  "blocker",
  "reference",
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export interface ContextItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ContextKind;
  readonly currentVersionId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly removedAt?: string;
}

export interface CreateContextItemInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ContextKind;
  readonly currentVersionId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export function createContextItem(input: CreateContextItemInput): ContextItem {
  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    kind: input.kind,
    currentVersionId: input.currentVersionId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
}

export function isContextItemRemoved(item: ContextItem): boolean {
  return item.removedAt !== undefined;
}

/**
 * Removal is a state transition, not a delete: the item and all of its
 * versions remain available for history.
 */
export function removeContextItem(item: ContextItem, removedAt: string): ContextItem {
  if (item.removedAt !== undefined) {
    return item;
  }

  return Object.freeze({ ...item, removedAt });
}

export function advanceContextItemVersion(
  item: ContextItem,
  currentVersionId: string,
): ContextItem {
  if (item.removedAt !== undefined) {
    throw new Error("Removed context items cannot receive new versions");
  }

  return Object.freeze({ ...item, currentVersionId });
}
