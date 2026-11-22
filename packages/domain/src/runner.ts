import { integer, object, optionalText, text, textArray, timestamp } from "./validation.js";

export const RUNNER_STATES = [
  "available",
  "busy",
  "offline",
  "upgrading",
  "error",
  "disabled",
] as const;
export type RunnerState = (typeof RUNNER_STATES)[number];

export interface Runner {
  id: string;
  teamId?: string | undefined;
  name: string;
  purpose: string;
  status: RunnerState;
  version: string;
  capabilities: string[];
  policyRevision: number;
  lastHeartbeatAt: string;
}

export function parseRunner(value: unknown): Runner {
  const input = object(value, "Runner");
  const status = text(input.status, "Runner.status");
  if (!RUNNER_STATES.includes(status as RunnerState))
    throw new TypeError(`Unsupported Runner.status: ${status}`);
  return {
    id: text(input.id, "Runner.id"),
    teamId: optionalText(input.teamId, "Runner.teamId"),
    name: text(input.name, "Runner.name"),
    purpose: text(input.purpose, "Runner.purpose"),
    status: status as RunnerState,
    version: text(input.version, "Runner.version"),
    capabilities: textArray(input.capabilities, "Runner.capabilities"),
    policyRevision: integer(input.policyRevision, "Runner.policyRevision"),
    lastHeartbeatAt: timestamp(input.lastHeartbeatAt, "Runner.lastHeartbeatAt"),
  };
}
