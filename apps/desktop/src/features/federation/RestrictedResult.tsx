export function RestrictedResult({
  state,
  reason,
}: {
  readonly state: "revoked" | "invalid" | "unavailable" | "outcome_unknown";
  readonly reason: string;
}) {
  return (
    <section className="notice notice--warning" data-testid="restricted-result" role="alert">
      <h2>Result restricted: {state}</h2>
      <p>{reason}</p>
      <p>
        No payload or cross-domain transfer is available. Unknown outcomes are never retried
        automatically.
      </p>
    </section>
  );
}
