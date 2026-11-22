export interface CitationView {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly recordedAt: string;
}

export function CitationList({ citations }: { readonly citations: readonly CitationView[] }) {
  return (
    <section aria-labelledby="citation-list-title">
      <h3 id="citation-list-title">Citations</h3>
      {citations.length === 0 ? (
        <p>No citations are available for this answer.</p>
      ) : (
        <ul>
          {citations.map((citation) => (
            <li
              key={`${citation.sourceType}:${citation.sourceId}:${citation.sourceRevision}`}
              data-testid="citation-item"
            >
              <code>
                {citation.sourceType}/{citation.sourceId}
              </code>{" "}
              · revision {citation.sourceRevision} · recorded{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(citation.recordedAt))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
