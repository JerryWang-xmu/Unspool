import { useEffect, useState } from "react";
import type { CollaborationClient, ContextItem } from "../../api/collaborationTypes";
import type { ArtifactView, RunnerClient, WorkspaceDetail } from "../../api/types";

export type WorkspaceOverviewClient = Pick<
  CollaborationClient,
  "getWorkspace" | "listContextItems"
>;

export interface WorkspaceOverviewProps {
  readonly client: WorkspaceOverviewClient;
  readonly workspaceId: string;
  readonly artifacts?: readonly ArtifactView[] | undefined;
  readonly artifactClient?: Pick<RunnerClient, "listArtifacts"> | undefined;
  readonly artifactsLoading?: boolean | undefined;
  readonly artifactsError?: string | null | undefined;
  readonly refreshToken?: number | undefined;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function WorkspaceOverview({
  client,
  workspaceId,
  artifacts,
  artifactClient,
  artifactsLoading = false,
  artifactsError = null,
  refreshToken = 0,
}: WorkspaceOverviewProps) {
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [fetchedArtifacts, setFetchedArtifacts] = useState<readonly ArtifactView[] | undefined>(
    undefined,
  );
  const [blockers, setBlockers] = useState<readonly ContextItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void refreshToken;
    let active = true;
    setLoading(true);
    void Promise.all([
      client.getWorkspace(workspaceId),
      client.listContextItems(workspaceId),
      artifactClient === undefined
        ? Promise.resolve(undefined)
        : artifactClient.listArtifacts(workspaceId),
    ])
      .then(([nextWorkspace, items, nextArtifacts]) => {
        if (!active) return;
        setWorkspace(nextWorkspace);
        setBlockers(items.filter((item) => item.kind === "blocker" && !item.removedAt));
        if (nextArtifacts !== undefined) setFetchedArtifacts(nextArtifacts);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, artifactClient, workspaceId, refreshToken]);

  const effectiveArtifacts = artifacts ?? fetchedArtifacts;
  const latestArtifacts =
    effectiveArtifacts === undefined
      ? []
      : [...effectiveArtifacts]
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
          )
          .slice(0, 5);
  return (
    <section
      className="panel"
      data-testid="workspace-overview"
      aria-labelledby="workspace-overview-title"
    >
      <p className="eyebrow">Shared workspace</p>
      <h2 id="workspace-overview-title">{workspace?.name ?? "Workspace overview"}</h2>
      {loading ? <p role="status">Loading workspace and blockers…</p> : null}
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {workspace !== null ? (
        <dl className="workspace-meta">
          <div>
            <dt>Goal</dt>
            <dd data-testid="workspace-goal">{workspace.goal || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Completion criteria</dt>
            <dd data-testid="workspace-criteria">
              {workspace.completionCriteria || "Not recorded"}
            </dd>
          </div>
          <div>
            <dt>Current operator</dt>
            <dd data-testid="current-operator">
              {workspace.currentOperator
                ? `${workspace.currentOperator.operatorId} (epoch ${workspace.currentOperator.operatorEpoch})`
                : "Not reported"}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd data-testid="workspace-status">{workspace.status}</dd>
          </div>
        </dl>
      ) : null}
      <section aria-labelledby="workspace-blockers-title">
        <h3 id="workspace-blockers-title">Blockers</h3>
        {blockers.length === 0 ? (
          <p>No active blockers were returned.</p>
        ) : (
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker.id} data-testid="workspace-blocker">
                <strong>{blocker.currentVersion.title}</strong>
                <p>{blocker.currentVersion.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="latest-artifacts-title">
        <h3 id="latest-artifacts-title">Latest artifacts</h3>
        {artifactsLoading ? <p role="status">Loading artifacts…</p> : null}
        {artifactsError !== null ? (
          <p className="notice notice--error" role="alert">
            {artifactsError}
          </p>
        ) : null}
        {effectiveArtifacts === undefined && !artifactsLoading && artifactsError === null ? (
          <p role="status">Loading artifacts…</p>
        ) : null}
        {effectiveArtifacts !== undefined && latestArtifacts.length === 0 ? (
          <p>No artifacts yet.</p>
        ) : null}
        <ul>
          {latestArtifacts.map((artifact) => (
            <li
              key={`${artifact.artifactId ?? artifact.id}:${artifact.version}`}
              data-testid="latest-artifact"
            >
              <span>{artifact.name}</span> <span>v{artifact.version}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
