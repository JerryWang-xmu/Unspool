import type { JsonObject } from "./validation.js";
import { integer, object, optionalText, optionalTimestamp, text, timestamp } from "./validation.js";

export const WORKSPACE_KINDS = ["personal", "shared"] as const;
export const WORKSPACE_STATES = ["draft", "active", "archived"] as const;
export const WORKSPACE_VISIBILITIES = ["owner_private", "invited_members"] as const;
export const FEDERATION_MODES = [
  "disabled",
  "snapshot",
  "snapshot_tools",
  "snapshot_tools_patch",
] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];
export type WorkspaceStatus = (typeof WORKSPACE_STATES)[number];
export type WorkspaceVisibility = (typeof WORKSPACE_VISIBILITIES)[number];
export type FederationMode = (typeof FEDERATION_MODES)[number];

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  teamId?: string | undefined;
  ownerId: string;
  runnerId: string;
  name: string;
  goal: string;
  completionCriteria: string;
  status: WorkspaceStatus;
  visibility: WorkspaceVisibility;
  agentConfigSnapshot: JsonObject;
  federationMode: FederationMode;
  revision: number;
  createdAt: string;
  archivedAt?: string | undefined;
}

export function parseWorkspace(value: unknown): Workspace {
  const input = object(value, "Workspace");
  const kind = text(input.kind, "Workspace.kind") as WorkspaceKind;
  const status = text(input.status, "Workspace.status") as WorkspaceStatus;
  const visibility = text(input.visibility, "Workspace.visibility") as WorkspaceVisibility;
  const federationMode = text(input.federationMode, "Workspace.federationMode") as FederationMode;
  const teamId = optionalText(input.teamId, "Workspace.teamId");
  if (!WORKSPACE_KINDS.includes(kind)) throw new TypeError(`Unsupported Workspace.kind: ${kind}`);
  if (!WORKSPACE_STATES.includes(status))
    throw new TypeError(`Unsupported Workspace.status: ${status}`);
  if (!WORKSPACE_VISIBILITIES.includes(visibility))
    throw new TypeError(`Unsupported Workspace.visibility: ${visibility}`);
  if (!FEDERATION_MODES.includes(federationMode))
    throw new TypeError(`Unsupported Workspace.federationMode: ${federationMode}`);
  if (kind === "personal" && teamId !== undefined)
    throw new TypeError("personal Workspace requires teamId to be null");
  if (kind === "shared" && teamId === undefined)
    throw new TypeError("shared Workspace requires teamId");
  const name = text(input.name, "Workspace.name");
  if (name.length > 50) throw new TypeError("Workspace.name must be 1-50 characters");
  const goal = typeof input.goal === "string" ? input.goal : "";
  const completionCriteria =
    typeof input.completionCriteria === "string" ? input.completionCriteria : "";
  if (status === "active" && (goal.trim().length === 0 || completionCriteria.trim().length === 0)) {
    throw new TypeError("active Workspace requires goal and completionCriteria");
  }
  return {
    id: text(input.id, "Workspace.id"),
    kind,
    teamId,
    ownerId: text(input.ownerId, "Workspace.ownerId"),
    runnerId: text(input.runnerId, "Workspace.runnerId"),
    name,
    goal,
    completionCriteria,
    status,
    visibility,
    agentConfigSnapshot: object(input.agentConfigSnapshot, "Workspace.agentConfigSnapshot"),
    federationMode,
    revision: integer(input.revision, "Workspace.revision"),
    createdAt: timestamp(input.createdAt, "Workspace.createdAt"),
    archivedAt: optionalTimestamp(input.archivedAt, "Workspace.archivedAt"),
  };
}
