export interface BetaSupportProps {
  readonly supportState: "supported" | "limited" | "unsupported";
  readonly knownLimits: readonly string[];
  readonly onFeedback: (message: string) => Promise<void>;
  readonly onEmergencyDisable: () => Promise<void>;
}

export function BetaSupport({
  supportState,
  knownLimits,
  onFeedback,
  onEmergencyDisable,
}: BetaSupportProps) {
  return (
    <section className="panel" data-testid="beta-support" aria-labelledby="beta-support-title">
      <h2 id="beta-support-title">Federated Beta support</h2>
      <p>Support state: {supportState}</p>
      <h3>Known limits</h3>
      <ul>
        {knownLimits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
      <h3>Security boundary</h3>
      <p>
        Beta is off by default. Nodes use outbound mTLS only, explicit snapshots/Grants, no inbound
        listener, and no silent upgrade expansion.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const message = String(data.get("feedback") ?? "");
          if (message.trim()) void onFeedback(message.trim());
        }}
      >
        <label htmlFor="beta-feedback">
          Feedback
          <textarea id="beta-feedback" name="feedback" />
        </label>
        <button type="submit" className="button button--ghost">
          Send feedback
        </button>
      </form>
      <button
        type="button"
        className="button button--danger"
        data-testid="emergency-disable-beta"
        onClick={() => {
          void onEmergencyDisable();
        }}
      >
        Emergency-disable all federation
      </button>
    </section>
  );
}
