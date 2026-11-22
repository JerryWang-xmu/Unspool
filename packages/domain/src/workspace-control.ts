import { integer, object, optionalText, text, timestamp } from "./validation.js";

export interface WorkspaceControl {
  workspaceId: string;
  operatorId: string;
  operatorEpoch: number;
  activeRunId?: string | undefined;
  activeRunEpoch: number;
  revision: number;
  updatedAt: string;
}

export function parseWorkspaceControl(value: unknown): WorkspaceControl {
  const input = object(value, "WorkspaceControl");
  return {
    workspaceId: text(input.workspaceId, "WorkspaceControl.workspaceId"),
    operatorId: text(input.operatorId, "WorkspaceControl.operatorId"),
    operatorEpoch: integer(input.operatorEpoch, "WorkspaceControl.operatorEpoch", 1),
    activeRunId: optionalText(input.activeRunId, "WorkspaceControl.activeRunId"),
    activeRunEpoch: integer(input.activeRunEpoch, "WorkspaceControl.activeRunEpoch"),
    revision: integer(input.revision, "WorkspaceControl.revision"),
    updatedAt: timestamp(input.updatedAt, "WorkspaceControl.updatedAt"),
  };
}
