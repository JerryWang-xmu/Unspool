import {
  createCollaborationMetric,
  qualifiesForStableNorthStar,
  STABLE_NORTH_STAR_METRIC_NAME,
  type StableNorthStarActivity,
} from "../../../../packages/domain/src/collaboration-metric.js";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import type { AnalyticsEvent } from "./analytics-store.js";

export interface NorthStarInput {
  readonly week: string;
  readonly workspaces: readonly (StableNorthStarActivity & { readonly viewCount?: number })[];
}

export interface NorthStarResult {
  readonly count: number;
  readonly workspaceIds: string[];
}

const NON_EFFECTIVE_ACTIONS = new Set([
  "view",
  "login",
  "logout",
  "presence",
  "heartbeat",
  "online",
  "offline",
]);

export function calculateStableNorthStar(input: NorthStarInput): NorthStarResult {
  const workspaceIds = input.workspaces
    .filter((activity) =>
      qualifiesForStableNorthStar({
        ...activity,
        effectiveActions: activity.effectiveActions.filter(
          (action) => !NON_EFFECTIVE_ACTIONS.has(action.kind.toLowerCase()),
        ),
      }),
    )
    .map((activity) => activity.workspaceId);
  return { count: new Set(workspaceIds).size, workspaceIds: [...new Set(workspaceIds)] };
}

export const computeStableNorthStar = calculateStableNorthStar;

export function calculateCollaborationFunnel(events: readonly AnalyticsEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (
      ![
        "workspace_activated",
        "share_preview_created",
        "share_converted",
        "suggestion_created",
        "suggestion_adopted",
      ].includes(event.eventName)
    )
      continue;
    counts.set(event.eventName, (counts.get(event.eventName) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

export async function persistStableNorthStar(
  database: SqliteDatabase,
  input: NorthStarInput,
): Promise<void> {
  const metric = createCollaborationMetric({
    week: input.week,
    metricName: STABLE_NORTH_STAR_METRIC_NAME,
    subjectId: "stable",
    value: calculateStableNorthStar(input).count,
    calculationVersion: 1,
  });
  await database.execute(
    "INSERT INTO collaboration_metric (week, metric_name, subject_id, value, calculation_version) VALUES (?, ?, ?, ?, ?)",
    [
      metric.week,
      metric.metricName,
      metric.subjectId,
      metric.value,
      String(metric.calculationVersion),
    ],
  );
}
