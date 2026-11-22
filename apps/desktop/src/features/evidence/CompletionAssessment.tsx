import { useState } from "react";

export interface CompletionAssessmentProps {
  readonly runId: string;
  readonly blockingConclusionIds?: readonly string[];
  readonly reviewHistory?: readonly {
    id: string;
    previousState: string;
    newState: string;
    reason: string;
    reviewedAt: string;
  }[];
  readonly onAssess: (
    result: "complete" | "partial" | "incomplete" | "failed" | "cancelled",
    reason: string,
    exceptionReason?: string,
  ) => Promise<void>;
}

export function CompletionAssessment({
  runId,
  blockingConclusionIds = [],
  reviewHistory = [],
  onAssess,
}: CompletionAssessmentProps) {
  const [result, setResult] = useState<
    "complete" | "partial" | "incomplete" | "failed" | "cancelled"
  >("partial");
  const [reason, setReason] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      className="panel"
      data-testid="completion-assessment"
      aria-labelledby="completion-title"
    >
      <h2 id="completion-title">Manual completion assessment</h2>
      <p>Run: {runId}</p>
      {blockingConclusionIds.length > 0 ? (
        <p className="notice notice--warning" role="alert">
          Evidence still blocks an unqualified complete result: {blockingConclusionIds.join(", ")}
        </p>
      ) : null}
      <label htmlFor="completion-result">
        Result
        <select
          id="completion-result"
          value={result}
          onChange={(event) => setResult(event.target.value as typeof result)}
        >
          <option value="complete">Complete</option>
          <option value="partial">Partial</option>
          <option value="incomplete">Incomplete</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      <label htmlFor="completion-reason">
        Reason
        <textarea
          id="completion-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label htmlFor="completion-exception">
        Owner evidence exception (optional; preserves risk)
        <textarea
          id="completion-exception"
          value={exceptionReason}
          onChange={(event) => setExceptionReason(event.target.value)}
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
        onClick={() => {
          setError(null);
          void onAssess(
            result,
            reason.trim(),
            exceptionReason.trim() === "" ? undefined : exceptionReason.trim(),
          ).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        Record assessment
      </button>
      <details>
        <summary>Review history ({reviewHistory.length})</summary>
        <ul>
          {reviewHistory.map((review) => (
            <li key={review.id}>
              {review.previousState} → {review.newState}: {review.reason} · {review.reviewedAt}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
