export class FederationLongPoll {
  readonly #endpoint: URL;
  readonly #maxBackoffMs: number;
  #backoffMs = 250;
  #cursor = 0;

  constructor(endpoint: string, options: { maxBackoffMs?: number } = {}) {
    this.#endpoint = new URL(endpoint);
    if (this.#endpoint.protocol !== "https:") throw new Error("mtls_https_required");
    this.#maxBackoffMs = options.maxBackoffMs ?? 5_000;
  }

  get inboundListener(): false {
    return false;
  }
  get backoffMs(): number {
    return this.#backoffMs;
  }
  get cursor(): number {
    return this.#cursor;
  }

  poll(input: { receipts: readonly unknown[]; operations: readonly unknown[] }) {
    const prioritized = [...input.receipts, ...input.operations];
    this.#cursor += prioritized.length;
    this.#backoffMs =
      prioritized.length === 0 ? Math.min(this.#backoffMs * 2, this.#maxBackoffMs) : 250;
    return { items: prioritized, nextCursor: this.#cursor, inboundListener: false as const };
  }
}
