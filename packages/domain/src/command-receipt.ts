import { object, text, timestamp } from "./validation.js";

export interface CommandReceipt {
  actorId: string;
  workspaceId: string;
  commandId: string;
  payloadDigest: string;
  responseDigest: string;
  acceptedAt: string;
  response: unknown;
}

export function parseCommandReceipt(value: unknown): CommandReceipt {
  const input = object(value, "CommandReceipt");
  return {
    actorId: text(input.actorId, "CommandReceipt.actorId"),
    workspaceId: text(input.workspaceId, "CommandReceipt.workspaceId"),
    commandId: text(input.commandId, "CommandReceipt.commandId"),
    payloadDigest: text(input.payloadDigest, "CommandReceipt.payloadDigest"),
    responseDigest: text(input.responseDigest, "CommandReceipt.responseDigest"),
    acceptedAt: timestamp(input.acceptedAt, "CommandReceipt.acceptedAt"),
    response: input.response,
  };
}
