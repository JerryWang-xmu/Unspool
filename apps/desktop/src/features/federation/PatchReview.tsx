export interface PatchReviewProps {
  readonly conflicts: readonly { path: string; expectedDigest: string; currentDigest: string }[];
  readonly onApply: () => Promise<void>;
}

export function PatchReview({ conflicts, onApply }: PatchReviewProps) {
  return (
    <section className="panel" data-testid="patch-review" aria-labelledby="patch-review-title">
      <h2 id="patch-review-title">Patch conflict review</h2>
      {conflicts.length > 0 ? (
        <div className="notice notice--warning">
          <p>Base files changed. No automatic merge or writeback is allowed.</p>
          <ul>
            {conflicts.map((conflict) => (
              <li key={conflict.path}>
                {conflict.path}: expected {conflict.expectedDigest}, current{" "}
                {conflict.currentDigest}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>All base preconditions match. Independent application still requires its own Grant.</p>
      )}
      <button
        type="button"
        className="button button--primary"
        disabled={conflicts.length > 0}
        onClick={() => {
          void onApply();
        }}
      >
        Apply independently with Grant
      </button>
    </section>
  );
}
