export interface ReceiptExplorerProps {
  readonly receipts: readonly {
    eventId: string;
    nodeSequence: number;
    reason: string;
    uploadState: string;
  }[];
  readonly gaps: readonly {
    fromSequence: number;
    toSequence: number;
    reason: string;
    resolvedAt?: string;
  }[];
}

export function ReceiptExplorer({ receipts, gaps }: ReceiptExplorerProps) {
  return (
    <section
      className="panel"
      data-testid="receipt-explorer"
      aria-labelledby="receipt-explorer-title"
    >
      <h2 id="receipt-explorer-title">Activity receipts</h2>
      <ul>
        {receipts.map((receipt) => (
          <li key={receipt.eventId} data-testid="receipt-item">
            #{receipt.nodeSequence} · {receipt.reason} · {receipt.uploadState}
          </li>
        ))}
      </ul>
      <details open={gaps.length > 0}>
        <summary>Receipt gaps ({gaps.length})</summary>
        <ul>
          {gaps.map((gap) => (
            <li key={`${gap.fromSequence}-${gap.toSequence}`} data-testid="receipt-gap">
              {gap.fromSequence}–{gap.toSequence}: {gap.reason} ·{" "}
              {gap.resolvedAt ? `resolved ${gap.resolvedAt}` : "open"}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
