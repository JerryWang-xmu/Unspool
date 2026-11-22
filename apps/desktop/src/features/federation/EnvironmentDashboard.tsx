export interface FederationNodeView {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly securityPosture: string;
  readonly activeExposures: readonly string[];
  readonly destinations: readonly string[];
}

export interface EnvironmentDashboardProps {
  readonly nodes: readonly FederationNodeView[];
  readonly onControl: (nodeId: string, action: "pause" | "revoke" | "isolate") => Promise<void>;
}

export function EnvironmentDashboard({ nodes, onControl }: EnvironmentDashboardProps) {
  return (
    <section
      className="panel"
      data-testid="environment-dashboard"
      aria-labelledby="environment-title"
    >
      <h2 id="environment-title">My environment</h2>
      {nodes.length === 0 ? (
        <p>No contributor nodes are registered.</p>
      ) : (
        nodes.map((node) => (
          <article key={node.id} data-testid="node-item" data-state={node.state}>
            <h3>{node.name}</h3>
            <p>
              State: {node.state} · Security posture: {node.securityPosture}
            </p>
            <p>
              Active exposure:{" "}
              {node.activeExposures.length === 0 ? "None" : node.activeExposures.join(", ")}
            </p>
            <p>
              Data destinations:{" "}
              {node.destinations.length === 0 ? "Local only" : node.destinations.join(", ")}
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  void onControl(node.id, "pause");
                }}
              >
                Pause
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  void onControl(node.id, "revoke");
                }}
              >
                Revoke
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  void onControl(node.id, "isolate");
                }}
              >
                Isolate
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
