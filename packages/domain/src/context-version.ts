export const MEMBER_VISIBILITIES = ["members", "private"] as const;
export type MemberVisibility = (typeof MEMBER_VISIBILITIES)[number];

export const AGENT_EXPOSURES = ["not_provided", "pending_operator", "provide_next_run"] as const;
export type AgentExposure = (typeof AGENT_EXPOSURES)[number];

/**
 * Canonical Attribution fields from data-model.md section 1.
 */
export interface ContextVersionAttribution {
  readonly actorId: string;
  readonly displayNameAtTime: string;
  readonly rolesAtTime: readonly string[];
  readonly occurredAt: string;
}

export interface ContextVersion {
  readonly id: string;
  readonly contextItemId: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly sourceRefs: readonly string[];
  readonly memberVisibility: MemberVisibility;
  readonly agentExposure: AgentExposure;
  readonly attribution: ContextVersionAttribution;
  readonly supersedesId?: string;
}

export interface AppendContextVersionInput {
  readonly id: string;
  readonly contextItemId: string;
  readonly title: string;
  readonly body: string;
  readonly sourceRefs?: readonly string[];
  readonly memberVisibility: MemberVisibility;
  readonly agentExposure: AgentExposure;
  readonly attribution: ContextVersionAttribution;
}

export interface CreateContextVersionInput extends AppendContextVersionInput {
  readonly version: number;
  readonly supersedesId?: string;
}

export class ContextVersionConflictError extends Error {
  readonly code = "revision_conflict";

  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Context version conflict: expected version ${expectedVersion}, current version is ${actualVersion}`,
    );
    this.name = "ContextVersionConflictError";
  }
}

/**
 * Versions are immutable, including their nested arrays and attribution
 * snapshot. Callers must append a new version instead of mutating this one.
 */
export function createContextVersion(input: CreateContextVersionInput): ContextVersion {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new RangeError("ContextVersion.version must be a positive safe integer");
  }

  return Object.freeze({
    id: input.id,
    contextItemId: input.contextItemId,
    version: input.version,
    title: input.title,
    body: input.body,
    sourceRefs: Object.freeze([...(input.sourceRefs ?? [])]),
    memberVisibility: input.memberVisibility,
    agentExposure: input.agentExposure,
    attribution: Object.freeze({
      ...input.attribution,
      rolesAtTime: Object.freeze([...input.attribution.rolesAtTime]),
    }),
    ...(input.supersedesId === undefined ? {} : { supersedesId: input.supersedesId }),
  });
}

/**
 * Append a version only when the caller's expected version matches the current
 * version. The first version expects 0; every later version supersedes the
 * current one.
 */
export function createNextContextVersion(
  current: ContextVersion | null,
  expectedVersion: number,
  input: AppendContextVersionInput,
): ContextVersion {
  const actualVersion = current?.version ?? 0;
  if (expectedVersion !== actualVersion) {
    throw new ContextVersionConflictError(expectedVersion, actualVersion);
  }
  if (current !== null && current.contextItemId !== input.contextItemId) {
    throw new RangeError("A context version can only supersede the same context item");
  }

  return createContextVersion({
    ...input,
    version: actualVersion + 1,
    ...(current === null ? {} : { supersedesId: current.id }),
  });
}

/**
 * Member visibility and Agent exposure are independent axes. A private version
 * can still be explicitly exposed to the Agent after operator confirmation,
 * and a members-visible version is not exposed until provide_next_run.
 */
export function canMemberReadContextVersion(version: ContextVersion, memberId: string): boolean {
  return version.memberVisibility === "members" || version.attribution.actorId === memberId;
}

export function isAgentExposed(version: ContextVersion): boolean {
  return version.agentExposure === "provide_next_run";
}
