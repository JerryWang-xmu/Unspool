import type { RunState } from "../../api/types";

const ACTIVE_RUN_STATES: ReadonlySet<RunState> = new Set([
  "created",
  "running",
  "waiting_approval",
  "stopping",
  "needs_confirmation",
]);

export function isRunActive(state: RunState | null): boolean {
  return state !== null && ACTIVE_RUN_STATES.has(state);
}

export function runStateLabel(state: RunState): string {
  switch (state) {
    case "waiting_approval":
      return "Waiting for approval";
    case "technical_complete":
      return "Technically complete - result needs confirmation";
    case "needs_confirmation":
      return "Needs human confirmation";
    default:
      return state.replaceAll("_", " ");
  }
}
