export interface UnknownOutcomePanelProps {
  readonly lastKnownCheckpoint?: Readonly<Record<string, unknown>> | undefined;
  readonly unknownReason?: string | undefined;
  readonly onRefresh: () => void;
}

export function UnknownOutcomePanel({
  lastKnownCheckpoint,
  unknownReason,
  onRefresh,
}: UnknownOutcomePanelProps) {
  return (
    <section
      className="notice notice--warning unknown-outcome"
      data-testid="unknown-outcome-panel"
      aria-labelledby="unknown-outcome-title"
    >
      <h3 id="unknown-outcome-title">Execution outcome needs confirmation</h3>
      <p data-testid="no-blind-retry">
        A tool or worker may have crossed the side-effect boundary. Do not retry, replay a Permit,
        release queued instructions, or start a duplicate action until the real outcome is checked.
      </p>
      <p data-testid="last-known-state">
        Last known checkpoint:{" "}
        {lastKnownCheckpoint === undefined
          ? "No aligned checkpoint was reported"
          : JSON.stringify(lastKnownCheckpoint)}
      </p>
      {unknownReason === undefined ? null : <p>Runner note: {unknownReason}</p>}
      <button
        type="button"
        className="button button--ghost"
        data-testid="refresh-unknown-outcome"
        onClick={onRefresh}
      >
        Refresh authoritative state
      </button>
    </section>
  );
}
