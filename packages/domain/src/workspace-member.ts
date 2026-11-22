import { boolean, object, optionalTimestamp, text, timestamp } from "./validation.js";

export const WORKSPACE_MEMBER_ROLES = ["owner", "operator", "contributor", "observer"] as const;
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number];

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceMemberRole;
  canApprove: boolean;
  canReview: boolean;
  joinedAt: string;
  leftAt?: string | undefined;
}

export function parseWorkspaceMember(value: unknown): WorkspaceMember {
  const input = object(value, "WorkspaceMember");
  const role = text(input.role, "WorkspaceMember.role");
  if (!WORKSPACE_MEMBER_ROLES.includes(role as WorkspaceMemberRole)) {
    throw new TypeError(`Unsupported WorkspaceMember.role: ${role}`);
  }
  return {
    workspaceId: text(input.workspaceId, "WorkspaceMember.workspaceId"),
    userId: text(input.userId, "WorkspaceMember.userId"),
    role: role as WorkspaceMemberRole,
    canApprove: boolean(input.canApprove, "WorkspaceMember.canApprove"),
    canReview: boolean(input.canReview, "WorkspaceMember.canReview"),
    joinedAt: timestamp(input.joinedAt, "WorkspaceMember.joinedAt"),
    leftAt: optionalTimestamp(input.leftAt, "WorkspaceMember.leftAt"),
  };
}
