import { useState } from "react";

export interface ImpactReviewProps {
  readonly conclusionId: string;
  readonly impacts: readonly {
    id: string;
    targetType: string;
    targetId: string;
    impactKind: string;
    state: string;
  }[];
  readonly conflictSources: readonly {
    sourceId: string;
    sourceVersionId: string;
    contentDigest: string;
    lastConfirmedAt: string;
  }[];
  readonly onReview: (
    newState: "confirmed" | "review_required" | "invalid",
    reason: string,
  ) => Promise<void>;
}

export function ImpactReview({
  conclusionId,
  impacts,
  conflictSources,
  onReview,
}: ImpactReviewProps) {
  const [newState, setNewState] = useState<"confirmed" | "review_required" | "invalid">(
    "review_required",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel" data-testid="impact-review" aria-labelledby="impact-review-title">
      <h2 id="impact-review-title">Impact and source review</h2>
      <p>Conclusion: {conclusionId}</p>
      <ul>
        {impacts.map((impact) => (
          <li key={impact.id}>
            {impact.targetType}/{impact.targetId} · {impact.impactKind} · {impact.state}
          </li>
        ))}
      </ul>
      {conflictSources.length > 1 ? (
        <div className="notice notice--warning">
          <p>Conflicting sources are shown side by side. No source is selected automatically.</p>
          <ul>
            {conflictSources.map((source) => (
              <li key={source.sourceVersionId}>
                {source.sourceId} · {source.contentDigest} · {source.lastConfirmedAt}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label htmlFor="impact-state">
        Review outcome
        <select
          id="impact-state"
          value={newState}
          onChange={(event) => setNewState(event.target.value as typeof newState)}
        >
          <option value="confirmed">Confirmed after human review</option>
          <option value="review_required">Review required</option>
          <option value="invalid">Invalid</option>
        </select>
      </label>
      <label htmlFor="impact-reason">
        Reason
        <textarea
          id="impact-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={reason.trim().length === 0}
        onClick={() => {
          setError(null);
          void onReview(newState, reason.trim()).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        Record review
      </button>
    </section>
  );
}
