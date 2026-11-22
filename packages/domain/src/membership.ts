export const TEAM_ROLES = ["administrator", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["active", "disabled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type MembershipEffectiveStatus = MembershipStatus | "expired";

export interface Membership {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly teamRoles: readonly TeamRole[];
  readonly status: MembershipStatus;
  readonly expiresAt?: string;
}

export interface CreateMembershipInput {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly teamRoles: readonly TeamRole[];
  readonly status?: MembershipStatus;
  readonly expiresAt?: string;
}

export interface MembershipAccess {
  readonly effectiveStatus: MembershipEffectiveStatus;
  readonly identityActive: boolean;
  readonly existingSessionsActive: boolean;
  readonly workspaceReadActive: boolean;
  readonly workspaceOperationsActive: boolean;
  readonly historicalWorkspaceReadActive: boolean;
  readonly attributionPreserved: true;
}

function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

function instantMillis(value: string, field: string): number {
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    throw new RangeError(`${field} must be an RFC 3339 instant`);
  }
  return millis;
}

export function createMembership(input: CreateMembershipInput): Membership {
  if (input.teamRoles.length === 0) {
    throw new RangeError("Membership.teamRoles must contain at least one role");
  }
  if (new Set(input.teamRoles).size !== input.teamRoles.length) {
    throw new RangeError("Membership.teamRoles must not contain duplicates");
  }
  for (const role of input.teamRoles) {
    if (!isTeamRole(role)) {
      throw new RangeError(`Unsupported team role: ${String(role)}`);
    }
  }
  if (input.expiresAt !== undefined) {
    instantMillis(input.expiresAt, "Membership.expiresAt");
  }

  return Object.freeze({
    id: input.id,
    teamId: input.teamId,
    userId: input.userId,
    teamRoles: Object.freeze([...input.teamRoles]),
    status: input.status ?? "active",
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  });
}

export function effectiveMembershipStatus(
  membership: Membership,
  now: string,
): MembershipEffectiveStatus {
  const nowMillis = instantMillis(now, "now");
  if (membership.status === "disabled") {
    return "disabled";
  }
  if (
    membership.expiresAt !== undefined &&
    nowMillis >= instantMillis(membership.expiresAt, "Membership.expiresAt")
  ) {
    return "expired";
  }
  return "active";
}

export function isMembershipActive(membership: Membership, now: string): boolean {
  return effectiveMembershipStatus(membership, now) === "active";
}

/**
 * Expiry or deactivation immediately removes identity, existing-session, and
 * workspace access (including historical workspaces). Attribution already
 * written into contributions remains intact and must not be erased.
 */
export function membershipAccess(membership: Membership, now: string): MembershipAccess {
  const effectiveStatus = effectiveMembershipStatus(membership, now);
  const active = effectiveStatus === "active";

  return Object.freeze({
    effectiveStatus,
    identityActive: active,
    existingSessionsActive: active,
    workspaceReadActive: active,
    workspaceOperationsActive: active,
    historicalWorkspaceReadActive: active,
    attributionPreserved: true,
  });
}
