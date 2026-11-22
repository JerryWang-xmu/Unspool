export interface WorkspaceStatisticsInput {
  readonly runs: readonly { startedAt: string; endedAt?: string; state: string }[];
  readonly effectiveActions: readonly { actorId: string; kind: string }[];
  readonly handoffs: readonly { startedAt: string; acceptedAt?: string }[];
  readonly approvals: readonly { createdAt: string; decidedAt?: string }[];
  readonly usage: readonly { provider: string; costAmount?: number; reliability: string }[];
}

function milliseconds(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

export class StatisticsService {
  summarize(input: WorkspaceStatisticsInput) {
    const effectiveMembers = new Set(
      input.effectiveActions
        .filter((action) => !["view", "login", "presence", "heartbeat"].includes(action.kind))
        .map((action) => action.actorId),
    );
    const reliableUsage = input.usage.filter((record) => record.reliability === "reliable");
    return {
      runDurationMs: input.runs.reduce(
        (total, run) =>
          total + (run.endedAt === undefined ? 0 : milliseconds(run.startedAt, run.endedAt)),
        0,
      ),
      effectiveMemberCount: effectiveMembers.size,
      handoffDurationMs: input.handoffs.reduce(
        (total, handoff) =>
          total +
          (handoff.acceptedAt === undefined
            ? 0
            : milliseconds(handoff.startedAt, handoff.acceptedAt)),
        0,
      ),
      approvalDurationMs: input.approvals.reduce(
        (total, approval) =>
          total +
          (approval.decidedAt === undefined
            ? 0
            : milliseconds(approval.createdAt, approval.decidedAt)),
        0,
      ),
      reliableCostAmount: reliableUsage.reduce(
        (total, record) => total + (record.costAmount ?? 0),
        0,
      ),
      costReliability: reliableUsage.length > 0 ? "reliable" : "unavailable",
    };
  }
}
