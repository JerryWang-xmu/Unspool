import type { JsonObject } from "./validation.js";
import { integer, object, optionalText, text, timestamp } from "./validation.js";

export const RUN_COMMAND_KINDS = ["start", "steer", "follow_up", "stop", "queue_action"] as const;
export type RunCommandKind = (typeof RUN_COMMAND_KINDS)[number];

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface RunCommand {
  id: string;
  runId?: string | undefined;
  workspaceId: string;
  kind: RunCommandKind;
  payload: JsonObject;
  payloadDigest: string;
  commandId: string;
  actorId: string;
  operatorEpoch: number;
  acceptedAt: string;
  resultRef?: string | undefined;
}

/**
 * `commandId` is the idempotency key. `operatorEpoch` must match the current
 * operator before acceptance. `resultRef` points to an accepted result and is
 * never an execution-completion claim.
 */
export function parseRunCommand(value: unknown): RunCommand {
  const input = object(value, "RunCommand");
  const kind = text(input.kind, "RunCommand.kind");
  if (!RUN_COMMAND_KINDS.includes(kind as RunCommandKind)) {
    throw new TypeError(`Unsupported RunCommand.kind: ${kind}`);
  }
  const runId = optionalText(input.runId, "RunCommand.runId");
  if (kind !== "start" && runId === undefined) {
    throw new TypeError(`RunCommand.kind ${kind} requires runId`);
  }
  const payloadDigest = text(input.payloadDigest, "RunCommand.payloadDigest");
  if (!DIGEST_PATTERN.test(payloadDigest)) {
    throw new TypeError("RunCommand.payloadDigest must match sha256:<64 lowercase hex>");
  }
  return {
    id: text(input.id, "RunCommand.id"),
    runId,
    workspaceId: text(input.workspaceId, "RunCommand.workspaceId"),
    kind: kind as RunCommandKind,
    payload: object(input.payload, "RunCommand.payload"),
    payloadDigest,
    commandId: text(input.commandId, "RunCommand.commandId"),
    actorId: text(input.actorId, "RunCommand.actorId"),
    operatorEpoch: integer(input.operatorEpoch, "RunCommand.operatorEpoch", 1),
    acceptedAt: timestamp(input.acceptedAt, "RunCommand.acceptedAt"),
    resultRef: optionalText(input.resultRef, "RunCommand.resultRef"),
  };
}
