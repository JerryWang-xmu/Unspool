import { integer, object, optionalTimestamp, text, timestamp } from "./validation.js";

export const PREPARATION_SESSION_STATUSES = ["preparing", "ended"] as const;
export type PreparationSessionStatus = (typeof PREPARATION_SESSION_STATUSES)[number];

export interface PreparationSession {
  id: string;
  handoffId: string;
  recipientId: string;
  readOnlyConversationId: string;
  asOfRevision: number;
  latestRevision: number;
  status: PreparationSessionStatus;
  startedAt: string;
  endedAt?: string | undefined;
}

export interface CreatePreparationSessionInput {
  id: string;
  handoffId: string;
  recipientId: string;
  readOnlyConversationId: string;
  asOfRevision: number;
  latestRevision?: number | undefined;
  startedAt: string;
}

export function parsePreparationSession(value: unknown): PreparationSession {
  const input = object(value, "PreparationSession");
  const status = text(input.status, "PreparationSession.status") as PreparationSessionStatus;
  if (!PREPARATION_SESSION_STATUSES.includes(status)) {
    throw new TypeError(`Unsupported PreparationSession.status: ${status}`);
  }
  const asOfRevision = integer(input.asOfRevision, "PreparationSession.asOfRevision");
  const latestRevision = integer(input.latestRevision, "PreparationSession.latestRevision");
  if (latestRevision < asOfRevision) {
    throw new RangeError(
      "PreparationSession.latestRevision must be greater than or equal to asOfRevision",
    );
  }
  const endedAt = optionalTimestamp(input.endedAt, "PreparationSession.endedAt");
  return {
    id: text(input.id, "PreparationSession.id"),
    handoffId: text(input.handoffId, "PreparationSession.handoffId"),
    recipientId: text(input.recipientId, "PreparationSession.recipientId"),
    readOnlyConversationId: text(
      input.readOnlyConversationId,
      "PreparationSession.readOnlyConversationId",
    ),
    asOfRevision,
    latestRevision,
    status,
    startedAt: timestamp(input.startedAt, "PreparationSession.startedAt"),
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

/**
 * Preparation starts in its own read-only conversation at the summary
 * revision. Background changes may advance `latestRevision`, but never below
 * the revision the recipient has actually seen.
 */
export function createPreparationSession(input: CreatePreparationSessionInput): PreparationSession {
  return parsePreparationSession({
    ...input,
    latestRevision: input.latestRevision ?? input.asOfRevision,
    status: "preparing",
  });
}
