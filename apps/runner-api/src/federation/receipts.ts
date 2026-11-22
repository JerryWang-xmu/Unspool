import type {
  B0NodeReceipt,
  B0ReceiptGap,
  B0ReceiptUploadState,
} from "../../../../packages/test-support/src/federation/fixtures.js";

export class FederationReceiptLog {
  readonly #events = new Map<string, B0NodeReceipt>();
  readonly #sequences = new Map<string, number>();
  readonly #gaps: B0ReceiptGap[] = [];
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  append(receipt: B0NodeReceipt): { receipt: B0NodeReceipt; uploadState: B0ReceiptUploadState } {
    const existing = this.#events.get(receipt.eventId);
    if (existing !== undefined) return { receipt: existing, uploadState: "duplicate" };
    const previousSequence = this.#sequences.get(receipt.nodeId);
    if (previousSequence !== undefined) {
      if (receipt.nodeSequence <= previousSequence) throw new Error("receipt_sequence_conflict");
      if (receipt.nodeSequence > previousSequence + 1) {
        this.#gaps.push({
          nodeId: receipt.nodeId,
          fromSequence: previousSequence + 1,
          toSequence: receipt.nodeSequence - 1,
          detectedAt: this.#now().toISOString(),
          reason: "missing_node_sequence",
        });
        this.#events.set(receipt.eventId, receipt);
        this.#sequences.set(receipt.nodeId, receipt.nodeSequence);
        return { receipt, uploadState: "gap" };
      }
    }
    this.#events.set(receipt.eventId, receipt);
    this.#sequences.set(receipt.nodeId, receipt.nodeSequence);
    return { receipt, uploadState: "accepted" };
  }

  backfill(receipt: B0NodeReceipt): {
    receipt: B0NodeReceipt;
    uploadState: B0ReceiptUploadState;
    resolvedGap: boolean;
  } {
    const duplicate = this.#events.get(receipt.eventId);
    if (duplicate !== undefined)
      return { receipt: duplicate, uploadState: "duplicate", resolvedGap: false };
    const currentSequence = this.#sequences.get(receipt.nodeId);
    let result: { receipt: B0NodeReceipt; uploadState: B0ReceiptUploadState };
    if (currentSequence !== undefined && receipt.nodeSequence <= currentSequence) {
      const conflict = this.list(receipt.nodeId).some(
        (existing) => existing.nodeSequence === receipt.nodeSequence,
      );
      if (conflict) throw new Error("receipt_sequence_conflict");
      this.#events.set(receipt.eventId, receipt);
      result = { receipt, uploadState: "accepted" };
    } else {
      result = this.append(receipt);
    }
    let resolvedGap = false;
    for (const gap of this.#gaps) {
      if (
        gap.resolvedAt === undefined &&
        gap.nodeId === receipt.nodeId &&
        receipt.nodeSequence >= gap.fromSequence &&
        receipt.nodeSequence <= gap.toSequence
      ) {
        const index = this.#gaps.indexOf(gap);
        this.#gaps[index] = { ...gap, resolvedAt: this.#now().toISOString() };
        resolvedGap = true;
      }
    }
    return { ...result, resolvedGap };
  }

  list(nodeId?: string): B0NodeReceipt[] {
    return [...this.#events.values()]
      .filter((receipt) => nodeId === undefined || receipt.nodeId === nodeId)
      .sort((left, right) => left.nodeSequence - right.nodeSequence);
  }

  gaps(nodeId?: string): B0ReceiptGap[] {
    return this.#gaps.filter((gap) => nodeId === undefined || gap.nodeId === nodeId);
  }

  reviewMalicious(receipts: readonly B0NodeReceipt[]): {
    state: "review_required";
    verifiedBusinessFact: false;
    reason: string;
  } {
    const outcomes = new Set(receipts.map((receipt) => receipt.result.outcome));
    return {
      state: "review_required",
      verifiedBusinessFact: false,
      reason:
        outcomes.size > 1
          ? "contradictory_node_receipts"
          : "untrusted_node_receipt_requires_evidence_review",
    };
  }
}
