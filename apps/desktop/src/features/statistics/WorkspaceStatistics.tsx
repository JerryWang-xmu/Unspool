export interface WorkspaceStatisticsProps {
  readonly runDurationMs: number;
  readonly effectiveMemberCount: number;
  readonly handoffDurationMs: number;
  readonly approvalDurationMs: number;
  readonly reliableCostAmount: number;
  readonly costReliability: string;
}

function duration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function WorkspaceStatistics(props: WorkspaceStatisticsProps) {
  return (
    <section
      className="panel"
      data-testid="workspace-statistics"
      aria-labelledby="statistics-title"
    >
      <h2 id="statistics-title">Workspace statistics</h2>
      <dl className="workspace-meta">
        <div>
          <dt>Run duration</dt>
          <dd>{duration(props.runDurationMs)}</dd>
        </div>
        <div>
          <dt>Effective members</dt>
          <dd>{props.effectiveMemberCount}</dd>
        </div>
        <div>
          <dt>Handoff duration</dt>
          <dd>{duration(props.handoffDurationMs)}</dd>
        </div>
        <div>
          <dt>Approval duration</dt>
          <dd>{duration(props.approvalDurationMs)}</dd>
        </div>
        <div>
          <dt>Reliable cost</dt>
          <dd>
            {props.reliableCostAmount} ({props.costReliability})
          </dd>
        </div>
      </dl>
    </section>
  );
}
