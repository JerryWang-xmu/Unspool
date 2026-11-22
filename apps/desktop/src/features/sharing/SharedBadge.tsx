import type { WorkspaceDetail } from "../../api/types";

export interface SharedBadgeProps {
  readonly kind: WorkspaceDetail["kind"];
  readonly teamId?: string | undefined;
  readonly status?: WorkspaceDetail["status"] | undefined;
  readonly detail?: string | undefined;
}

/**
 * Renders the shared state recorded on the workspace itself, so the indicator
 * persists across views, refreshes, and reconnections instead of depending on
 * a transient "share completed" message.
 */
export function SharedBadge({ kind, teamId, status, detail }: SharedBadgeProps) {
  if (kind !== "shared") {
    return null;
  }
  const label =
    status === undefined
      ? "Shared workspace"
      : `Shared workspace (${status === "unknown" ? "status unknown" : status})`;
  return (
    <span
      className="tag tag--active"
      data-testid="shared-badge"
      data-shared-state="shared"
      title={
        teamId === undefined
          ? "This workspace is shared with its invited members."
          : `Shared with invited members of team ${teamId}.`
      }
    >
      {label}
      {teamId === undefined ? "" : ` · team ${teamId}`}
      {detail === undefined || detail.trim().length === 0 ? "" : ` · ${detail}`}
    </span>
  );
}
