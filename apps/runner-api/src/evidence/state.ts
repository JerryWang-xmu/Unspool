import { createHash, randomUUID } from "node:crypto";
import { ProblemError } from "../errors/problem.js";

export interface EvidenceActor {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "human" | "agent";
  readonly role: "owner" | "operator" | "contributor" | "observer";
  readonly canReview: boolean;
  readonly canApprove: boolean;
}

export interface RunState {
  readonly id: string;
  state: string;
  result?: string;
}

export interface ArtifactState {
  readonly id: string;
  readonly runId?: string | undefined;
  name: string;
  bytes: Uint8Array | null;
  declaredSize: number;
  sha256: string;
  deleted: boolean;
  inaccessible: boolean;
  unknown?: boolean | undefined;
}

export interface WorkspaceEvidenceState {
  readonly id: string;
  name: string;
  status: string;
  goal: string;
  completionCriteria: string;
  readonly runs: Map<string, RunState>;
  readonly conclusions: Map<string, any>;
  readonly sources: Map<string, any>;
  readonly sourceVersions: Map<string, any>;
  readonly links: any[];
  readonly impacts: any[];
  readonly reviews: any[];
  readonly exceptions: any[];
  readonly assessments: any[];
  readonly artifacts: Map<string, ArtifactState>;
  readonly pendingActions: Map<
    string,
    { id: string; state: string; revoked: boolean; executed: boolean; outcome?: string | undefined }
  >;
  readonly exports: Map<string, any>;
  readonly notificationCountBySource: Record<string, number>;
}

export function createEvidenceState(
  id: string,
  name = "Evidence workspace",
): WorkspaceEvidenceState {
  return {
    id: `${id}-${randomUUID()}`,
    name,
    status: "active",
    goal: "Evidence-backed task",
    completionCriteria: "Review every conclusion",
    runs: new Map(),
    conclusions: new Map(),
    sources: new Map(),
    sourceVersions: new Map(),
    links: [],
    impacts: [],
    reviews: [],
    exceptions: [],
    assessments: [],
    artifacts: new Map(),
    pendingActions: new Map(),
    exports: new Map(),
    notificationCountBySource: {},
  };
}

export function evidenceNow(): string {
  return new Date().toISOString();
}

export function evidenceId(): string {
  return randomUUID();
}

export function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function actorCanReview(actor: EvidenceActor): void {
  if (actor.kind !== "human" || !actor.canReview) throw new ProblemError("permission_denied");
}

export function actorCanMutate(actor: EvidenceActor): void {
  if (actor.role === "observer") throw new ProblemError("permission_denied");
}

export function assertMutable(state: WorkspaceEvidenceState): void {
  if (state.status === "archived") throw new ProblemError("workspace_archived");
}

export function requireEntity<T>(value: T | undefined, code = "not_found"): T {
  if (value === undefined) throw new ProblemError(code as never);
  return value;
}

export function requireReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ProblemError("invalid_request");
  return value;
}

export function requireDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new ProblemError("invalid_request");
  return value;
}
