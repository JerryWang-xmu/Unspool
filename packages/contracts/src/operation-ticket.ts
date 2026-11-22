import type { B0OperationTicket } from "../../test-support/src/federation/fixtures.js";
import { fedDigest, fedObject, fedText, fedTime } from "./federation-validation.js";

export type { B0OperationTicket as OperationTicket } from "../../test-support/src/federation/fixtures.js";

export interface OperationTicketValidationInput {
  readonly now: Date | string;
  readonly grantDigest: string;
  readonly recipientDigest: string;
  readonly bodyDigest: string;
  readonly usedRequestIds?: ReadonlySet<string>;
  readonly usedNonces?: ReadonlySet<string>;
}

export function parseOperationTicket(value: unknown): B0OperationTicket {
  const input = fedObject(value, "OperationTicket");
  const nonce = fedText(input.nonce, "OperationTicket.nonce");
  if (nonce.length < 16)
    throw new TypeError("OperationTicket.nonce must contain at least 16 characters");
  return {
    requestId: fedText(input.requestId, "OperationTicket.requestId"),
    nonce,
    executionId: fedText(input.executionId, "OperationTicket.executionId"),
    nodeId: fedText(input.nodeId, "OperationTicket.nodeId"),
    runId: fedText(input.runId, "OperationTicket.runId"),
    grantDigest: fedDigest(input.grantDigest, "OperationTicket.grantDigest"),
    actionDigest: fedDigest(input.actionDigest, "OperationTicket.actionDigest"),
    recipientDigest: fedDigest(input.recipientDigest, "OperationTicket.recipientDigest"),
    bodyDigest: fedDigest(input.bodyDigest, "OperationTicket.bodyDigest"),
    notBefore: fedTime(input.notBefore, "OperationTicket.notBefore"),
    expiresAt: fedTime(input.expiresAt, "OperationTicket.expiresAt"),
    signature: fedText(input.signature, "OperationTicket.signature"),
  };
}

export function validateOperationTicket(
  value: unknown,
  input: OperationTicketValidationInput,
): B0OperationTicket {
  const ticket = parseOperationTicket(value);
  const now = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);
  if (!Number.isFinite(now)) throw new TypeError("OperationTicket.now is invalid");
  if (Date.parse(ticket.notBefore) > now) throw new RangeError("ticket_not_yet_valid");
  if (Date.parse(ticket.expiresAt) <= now) throw new RangeError("ticket_expired");
  if (Date.parse(ticket.expiresAt) - Date.parse(ticket.notBefore) > 60_000)
    throw new RangeError("ticket_window_exceeded");
  if (ticket.grantDigest !== input.grantDigest) throw new RangeError("grant_digest_mismatch");
  if (ticket.recipientDigest !== input.recipientDigest)
    throw new RangeError("recipient_digest_mismatch");
  if (ticket.bodyDigest !== input.bodyDigest) throw new RangeError("body_digest_mismatch");
  if (input.usedRequestIds?.has(ticket.requestId) || input.usedNonces?.has(ticket.nonce))
    throw new RangeError("ticket_replay_denied");
  return ticket;
}
