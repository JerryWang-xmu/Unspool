import { object, text } from "./validation.js";
export interface ConclusionImpact {
  id: string;
  conclusionId: string;
  targetType: "conclusion" | "completion_criterion" | "artifact" | "pending_action";
  targetId: string;
  impactKind: string;
  state: "review_required" | "resolved";
}
export function createConclusionImpact(input: ConclusionImpact): ConclusionImpact {
  const value = object(input, "ConclusionImpact");
  const targetType = text(
    value.targetType,
    "ConclusionImpact.targetType",
  ) as ConclusionImpact["targetType"];
  if (!["conclusion", "completion_criterion", "artifact", "pending_action"].includes(targetType))
    throw new TypeError(`Unsupported ConclusionImpact.targetType: ${targetType}`);
  const state = text(value.state, "ConclusionImpact.state");
  if (state !== "review_required" && state !== "resolved")
    throw new TypeError(`Unsupported ConclusionImpact.state: ${state}`);
  return {
    id: text(value.id, "ConclusionImpact.id"),
    conclusionId: text(value.conclusionId, "ConclusionImpact.conclusionId"),
    targetType,
    targetId: text(value.targetId, "ConclusionImpact.targetId"),
    impactKind: text(value.impactKind, "ConclusionImpact.impactKind"),
    state,
  };
}
