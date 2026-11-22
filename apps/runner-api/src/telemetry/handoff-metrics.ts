import type { createAnalyticsStore } from "./analytics-store.js";

type AnalyticsStore = ReturnType<typeof createAnalyticsStore>;

export async function recordHandoffPreparationDuration(
  store: AnalyticsStore,
  input: {
    occurredAt: string;
    durationMs: number;
    actorPseudonym?: string;
    workspacePseudonym?: string;
    refreshedBeforeAccept?: boolean;
  },
): Promise<void> {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0)
    throw new RangeError("durationMs must be non-negative");
  await store.record({
    eventName: "handoff_preparation_duration",
    occurredAt: input.occurredAt,
    ...(input.actorPseudonym === undefined ? {} : { actorPseudonym: input.actorPseudonym }),
    ...(input.workspacePseudonym === undefined
      ? {}
      : { workspacePseudonym: input.workspacePseudonym }),
    metadata: {
      durationMs: input.durationMs,
      refreshedBeforeAccept: input.refreshedBeforeAccept === true,
    },
  });
}

export async function recordHandoffAcceptance(
  store: AnalyticsStore,
  input: {
    occurredAt: string;
    accepted: boolean;
    targetType?: string;
    actorPseudonym?: string;
    workspacePseudonym?: string;
  },
): Promise<void> {
  await store.record({
    eventName: input.accepted ? "handoff_accepted" : "handoff_rejected",
    occurredAt: input.occurredAt,
    ...(input.actorPseudonym === undefined ? {} : { actorPseudonym: input.actorPseudonym }),
    ...(input.workspacePseudonym === undefined
      ? {}
      : { workspacePseudonym: input.workspacePseudonym }),
    metadata: {
      accepted: input.accepted,
      ...(input.targetType === undefined ? {} : { targetType: input.targetType }),
    },
  });
}
