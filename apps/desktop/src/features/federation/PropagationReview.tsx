import { useState } from "react";

export interface PropagationReviewProps {
  readonly sourceApproved: boolean;
  readonly recipientApproved: boolean;
  readonly onSourceApprove: () => Promise<void>;
  readonly onRecipientApprove: () => Promise<void>;
  readonly onTransfer: () => Promise<void>;
}

export function PropagationReview({
  sourceApproved,
  recipientApproved,
  onSourceApprove,
  onRecipientApprove,
  onTransfer,
}: PropagationReviewProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel" data-testid="propagation-review" aria-labelledby="propagation-title">
      <h2 id="propagation-title">Cross-domain propagation approval</h2>
      <p>
        Both source owner and recipient owner must approve before any payload moves. Derived labels
        never widen model, member, or public visibility.
      </p>
      <p>
        Source owner: {sourceApproved ? "Approved" : "Pending"} · Recipient owner:{" "}
        {recipientApproved ? "Approved" : "Pending"}
      </p>
      <div className="button-row">
        <button
          type="button"
          className="button button--ghost"
          disabled={sourceApproved}
          onClick={() => {
            void onSourceApprove();
          }}
        >
          Approve as source owner
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={recipientApproved}
          onClick={() => {
            void onRecipientApprove();
          }}
        >
          Approve as recipient owner
        </button>
      </div>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={!sourceApproved || !recipientApproved}
        onClick={() => {
          setError(null);
          void onTransfer().catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        Transfer derived artifact
      </button>
    </section>
  );
}
