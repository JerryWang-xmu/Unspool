import type { JsonObject } from "./validation.js";
import { object, optionalText, text } from "./validation.js";

export const RUNNER_SUBJECT_TYPES = ["user", "team"] as const;
export type RunnerSubjectType = (typeof RUNNER_SUBJECT_TYPES)[number];

export interface RunnerGrant {
  runnerId: string;
  teamId?: string | undefined;
  subjectType: RunnerSubjectType;
  subjectId: string;
  allowedPolicy: JsonObject;
}

export function parseRunnerGrant(value: unknown): RunnerGrant {
  const input = object(value, "RunnerGrant");
  const subjectType = text(input.subjectType, "RunnerGrant.subjectType") as RunnerSubjectType;
  if (!RUNNER_SUBJECT_TYPES.includes(subjectType))
    throw new TypeError(`Unsupported RunnerGrant.subjectType: ${subjectType}`);
  const teamId = optionalText(input.teamId, "RunnerGrant.teamId");
  if (subjectType === "user" && teamId !== undefined)
    throw new TypeError("personal RunnerGrant requires teamId to be null");
  if (subjectType === "team" && teamId === undefined)
    throw new TypeError("team RunnerGrant requires teamId");
  return {
    runnerId: text(input.runnerId, "RunnerGrant.runnerId"),
    teamId,
    subjectType,
    subjectId: text(input.subjectId, "RunnerGrant.subjectId"),
    allowedPolicy: object(input.allowedPolicy, "RunnerGrant.allowedPolicy"),
  };
}
