import { object, text, timestamp } from "./validation.js";

export interface InboxReceipt {
  consumerId: string;
  messageId: string;
  receivedAt: string;
  resultDigest: string;
}

export function parseInboxReceipt(value: unknown): InboxReceipt {
  const input = object(value, "InboxReceipt");
  return {
    consumerId: text(input.consumerId, "InboxReceipt.consumerId"),
    messageId: text(input.messageId, "InboxReceipt.messageId"),
    receivedAt: timestamp(input.receivedAt, "InboxReceipt.receivedAt"),
    resultDigest: text(input.resultDigest, "InboxReceipt.resultDigest"),
  };
}
