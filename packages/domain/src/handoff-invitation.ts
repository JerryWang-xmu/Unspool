import { integer, object, optionalText, optionalTimestamp, text, timestamp } from "./validation.js";

export const HANDOFF_INVITATION_STATUSES = [
  "invited",
  "preparing",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
] as const;
export type HandoffInvitationStatus = (typeof HANDOFF_INVITATION_STATUSES)[number];

export const HANDOFF_INVITATION_TERMINAL_STATUSES = [
  "accepted",
  "rejected",
  "cancelled",
  "expired",
] as const satisfies readonly HandoffInvitationStatus[];
export type HandoffInvitationTerminalStatus = (typeof HANDOFF_INVITATION_TERMINAL_STATUSES)[number];

export interface HandoffInvitation {
  id: string;
  workspaceId: string;
  fromOperatorId: string;
  recipientId: string;
  summarySnapshotId: string;
  baseRevision: number;
  status: HandoffInvitationStatus;
  reason?: string | undefined;
  createdAt: string;
  expiresAt?: string | undefined;
}

export interface CreateHandoffInvitationInput {
  id: string;
  workspaceId: string;
  fromOperatorId: string;
  recipientId: string;
  summarySnapshotId: string;
  baseRevision: number;
  reason?: string | undefined;
  createdAt: string;
  expiresAt?: string | undefined;
}

export function parseHandoffInvitation(value: unknown): HandoffInvitation {
  const input = object(value, "HandoffInvitation");
  const status = text(input.status, "HandoffInvitation.status") as HandoffInvitationStatus;
  if (!HANDOFF_INVITATION_STATUSES.includes(status)) {
    throw new TypeError(`Unsupported HandoffInvitation.status: ${status}`);
  }
  const reason = optionalText(input.reason, "HandoffInvitation.reason");
  const expiresAt = optionalTimestamp(input.expiresAt, "HandoffInvitation.expiresAt");
  return {
    id: text(input.id, "HandoffInvitation.id"),
    workspaceId: text(input.workspaceId, "HandoffInvitation.workspaceId"),
    fromOperatorId: text(input.fromOperatorId, "HandoffInvitation.fromOperatorId"),
    recipientId: text(input.recipientId, "HandoffInvitation.recipientId"),
    summarySnapshotId: text(input.summarySnapshotId, "HandoffInvitation.summarySnapshotId"),
    baseRevision: integer(input.baseRevision, "HandoffInvitation.baseRevision"),
    status,
    ...(reason === undefined ? {} : { reason }),
    createdAt: timestamp(input.createdAt, "HandoffInvitation.createdAt"),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

/**
 * A handoff starts `invited`; accepting without any preparation remains a
 * workspace-level operation and never changes the active Run state here.
 */
export function createHandoffInvitation(input: CreateHandoffInvitationInput): HandoffInvitation {
  return parseHandoffInvitation({ ...input, status: "invited" });
}

export function isHandoffInvitationTerminal(status: HandoffInvitationStatus): boolean {
  return (HANDOFF_INVITATION_TERMINAL_STATUSES as readonly string[]).includes(status);
}
