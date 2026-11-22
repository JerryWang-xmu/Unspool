import { integer, text } from "./validation.js";

export const STABLE_NORTH_STAR_METRIC_NAME = "stable_north_star";

export interface CollaborationMetric {
  readonly week: string;
  readonly metricName: string;
  readonly subjectId: string;
  readonly value: number;
  readonly calculationVersion: number;
}

export interface CreateCollaborationMetricInput {
  readonly week: string;
  readonly metricName: string;
  readonly subjectId: string;
  readonly value: number;
  readonly calculationVersion: number;
}

export interface StableNorthStarActivity {
  readonly workspaceId: string;
  readonly completedAgentRunCount: number;
  readonly memberIds: readonly string[];
  readonly effectiveActions: readonly {
    readonly actorId: string;
    readonly kind: string;
  }[];
}

export function createCollaborationMetric(
  input: CreateCollaborationMetricInput,
): CollaborationMetric {
  if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0) {
    throw new RangeError("CollaborationMetric.value must be a non-negative finite number");
  }

  return Object.freeze({
    week: text(input.week, "CollaborationMetric.week"),
    metricName: text(input.metricName, "CollaborationMetric.metricName"),
    subjectId: text(input.subjectId, "CollaborationMetric.subjectId"),
    value: input.value,
    calculationVersion: integer(
      input.calculationVersion,
      "CollaborationMetric.calculationVersion",
      1,
    ),
  });
}

/**
 * Stable north-star eligibility is exactly two conditions for a workspace in
 * the week: at least one completed Agent task, and at least two distinct
 * members with effective actions. Views, presence and login-only activity are
 * intentionally absent from the activity shape and therefore never count.
 */
export function qualifiesForStableNorthStar(activity: StableNorthStarActivity): boolean {
  if (!Number.isInteger(activity.completedAgentRunCount) || activity.completedAgentRunCount < 1) {
    return false;
  }

  const members = new Set(activity.memberIds);
  const effectiveCollaborators = new Set<string>();
  for (const action of activity.effectiveActions) {
    if (members.has(action.actorId)) {
      effectiveCollaborators.add(action.actorId);
    }
  }
  return effectiveCollaborators.size >= 2;
}
