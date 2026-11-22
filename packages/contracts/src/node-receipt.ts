import type { B0NodeReceipt, B0ReceiptGap } from "../../test-support/src/federation/fixtures.js";
import {
  fedDigest,
  federationDigest,
  fedInteger,
  fedObject,
  fedStrings,
  fedText,
  fedTime,
} from "./federation-validation.js";

export type {
  B0NodeReceipt as NodeReceipt,
  B0ReceiptGap as ReceiptGap,
} from "../../test-support/src/federation/fixtures.js";

export function parseNodeReceipt(value: unknown): B0NodeReceipt {
  const input = fedObject(value, "NodeReceipt");
  const result = fedObject(input.result, "NodeReceipt.result");
  const outcome = fedText(result.outcome, "NodeReceipt.result.outcome");
  if (outcome !== "reported_success" && outcome !== "reported_failure")
    throw new TypeError("Unsupported receipt outcome");
  const decision = fedText(input.decision, "NodeReceipt.decision");
  if (decision !== "accepted" && decision !== "denied")
    throw new TypeError("Unsupported receipt decision");
  return {
    eventId: fedText(input.eventId, "NodeReceipt.eventId"),
    nodeId: fedText(input.nodeId, "NodeReceipt.nodeId"),
    nodeSequence: fedInteger(input.nodeSequence, "NodeReceipt.nodeSequence", 1),
    previousDigest: fedDigest(input.previousDigest, "NodeReceipt.previousDigest"),
    runId: fedText(input.runId, "NodeReceipt.runId"),
    requestId: fedText(input.requestId, "NodeReceipt.requestId"),
    ...(input.executionId === undefined
      ? {}
      : { executionId: fedText(input.executionId, "NodeReceipt.executionId") }),
    actor: fedText(input.actor, "NodeReceipt.actor"),
    resourceDigest: fedDigest(input.resourceDigest, "NodeReceipt.resourceDigest"),
    operation: fedText(input.operation, "NodeReceipt.operation"),
    grantDigest: fedDigest(input.grantDigest, "NodeReceipt.grantDigest"),
    decision,
    reason: fedText(input.reason, "NodeReceipt.reason"),
    occurredAt: fedTime(input.occurredAt, "NodeReceipt.occurredAt"),
    result: {
      outcome,
      entryIds: fedStrings(result.entryIds, "NodeReceipt.result.entryIds"),
      claimedBytes: fedInteger(result.claimedBytes, "NodeReceipt.result.claimedBytes"),
      evidenceIds: fedStrings(result.evidenceIds, "NodeReceipt.result.evidenceIds"),
    },
    byteCount: fedInteger(input.byteCount, "NodeReceipt.byteCount"),
    destinations: fedStrings(input.destinations, "NodeReceipt.destinations"),
    labelDigest: fedDigest(input.labelDigest, "NodeReceipt.labelDigest"),
    uploadState: fedText(
      input.uploadState,
      "NodeReceipt.uploadState",
    ) as B0NodeReceipt["uploadState"],
    nodeSignature: fedText(input.nodeSignature, "NodeReceipt.nodeSignature"),
  };
}

export function nodeReceiptDigest(receipt: B0NodeReceipt): string {
  const { uploadState: _uploadState, ...canonical } = receipt;
  return federationDigest(canonical);
}

export function assertReceiptChain(previous: B0NodeReceipt, next: B0NodeReceipt): void {
  if (
    previous.nodeId !== next.nodeId ||
    next.nodeSequence !== previous.nodeSequence + 1 ||
    next.previousDigest !== nodeReceiptDigest(previous)
  ) {
    throw new RangeError("receipt_chain_mismatch");
  }
}

export function detectReceiptGaps(
  receipts: readonly B0NodeReceipt[],
  detectedAt: string,
): B0ReceiptGap[] {
  const gaps: B0ReceiptGap[] = [];
  const ordered = [...receipts].sort((left, right) => left.nodeSequence - right.nodeSequence);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.nodeSequence > previous.nodeSequence + 1)
      gaps.push({
        nodeId: current.nodeId,
        fromSequence: previous.nodeSequence + 1,
        toSequence: current.nodeSequence - 1,
        detectedAt,
        reason: "missing_node_sequence",
      });
  }
  return gaps;
}
