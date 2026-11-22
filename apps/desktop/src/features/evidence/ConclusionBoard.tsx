export interface ConclusionBoardItem {
  readonly id: string;
  readonly body: string;
  readonly kind: string;
  readonly state: string;
  readonly sourceVersionIds?: readonly string[];
  readonly sources: readonly {
    sourceId: string;
    sourceVersionId: string;
    relation: string;
    state: string;
    lastConfirmedAt: string;
  }[];
}

export function ConclusionBoard({
  conclusions,
  onSelect,
}: {
  readonly conclusions: readonly ConclusionBoardItem[];
  readonly onSelect?: (id: string) => void;
}) {
  return (
    <section
      className="panel"
      data-testid="conclusion-board"
      aria-labelledby="conclusion-board-title"
    >
      <h2 id="conclusion-board-title">Current conclusions</h2>
      {conclusions.length === 0 ? (
        <p>No conclusions have been recorded.</p>
      ) : (
        conclusions.map((conclusion) => (
          <article key={conclusion.id} data-testid="conclusion-item" data-state={conclusion.state}>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onSelect?.(conclusion.id)}
            >
              <strong>{conclusion.body}</strong>
            </button>
            <p>
              {conclusion.kind} · {conclusion.state}
            </p>
            <ul>
              {conclusion.sources.map((source) => (
                <li key={source.sourceVersionId}>
                  {source.relation}: {source.sourceId} · {source.state} · last confirmed{" "}
                  {source.lastConfirmedAt}
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </section>
  );
}
