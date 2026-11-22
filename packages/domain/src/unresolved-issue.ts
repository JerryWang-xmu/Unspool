import { object, text } from "./validation.js";

export const UNRESOLVED_ISSUE_VISIBILITIES = ["private", "shared"] as const;
export type UnresolvedIssueVisibility = (typeof UNRESOLVED_ISSUE_VISIBILITIES)[number];

export const UNRESOLVED_ISSUE_STATUSES = ["open", "resolved"] as const;
export type UnresolvedIssueStatus = (typeof UNRESOLVED_ISSUE_STATUSES)[number];

export interface UnresolvedIssue {
  id: string;
  preparationSessionId: string;
  body: string;
  visibility: UnresolvedIssueVisibility;
  status: UnresolvedIssueStatus;
}

export interface CreateUnresolvedIssueInput {
  id: string;
  preparationSessionId: string;
  body: string;
  visibility?: UnresolvedIssueVisibility | undefined;
  status?: UnresolvedIssueStatus | undefined;
}

export function parseUnresolvedIssue(value: unknown): UnresolvedIssue {
  const input = object(value, "UnresolvedIssue");
  const visibility = text(
    input.visibility,
    "UnresolvedIssue.visibility",
  ) as UnresolvedIssueVisibility;
  if (!UNRESOLVED_ISSUE_VISIBILITIES.includes(visibility)) {
    throw new TypeError(`Unsupported UnresolvedIssue.visibility: ${visibility}`);
  }
  const status = text(input.status, "UnresolvedIssue.status") as UnresolvedIssueStatus;
  if (!UNRESOLVED_ISSUE_STATUSES.includes(status)) {
    throw new TypeError(`Unsupported UnresolvedIssue.status: ${status}`);
  }
  return {
    id: text(input.id, "UnresolvedIssue.id"),
    preparationSessionId: text(input.preparationSessionId, "UnresolvedIssue.preparationSessionId"),
    body: text(input.body, "UnresolvedIssue.body"),
    visibility,
    status,
  };
}

/**
 * Issues are private by default. Sharing creates a discussion or handoff note
 * elsewhere; it never rewrites the original private question or answer.
 */
export function createUnresolvedIssue(input: CreateUnresolvedIssueInput): UnresolvedIssue {
  return parseUnresolvedIssue({
    ...input,
    visibility: input.visibility ?? "private",
    status: input.status ?? "open",
  });
}
