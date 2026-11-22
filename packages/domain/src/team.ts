export const TEAM_NAME_MAX_LENGTH = 100;

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly betaEnabled: boolean;
  readonly defaultPolicyRevision: number;
  readonly createdAt: string;
}

export interface CreateTeamInput {
  readonly id: string;
  readonly name: string;
  readonly defaultPolicyRevision?: number;
  readonly createdAt: string;
}

export function createTeam(input: CreateTeamInput): Team {
  const name = input.name.trim();
  if (name.length < 1 || name.length > TEAM_NAME_MAX_LENGTH) {
    throw new RangeError(`Team.name must be 1-${TEAM_NAME_MAX_LENGTH} characters`);
  }

  const defaultPolicyRevision = input.defaultPolicyRevision ?? 1;
  if (!Number.isSafeInteger(defaultPolicyRevision) || defaultPolicyRevision < 1) {
    throw new RangeError("Team.defaultPolicyRevision must be a positive safe integer");
  }

  return Object.freeze({
    id: input.id,
    name,
    betaEnabled: false,
    defaultPolicyRevision,
    createdAt: input.createdAt,
  });
}

/**
 * Upgrades never enable Federated Beta implicitly. Team creation and upgrades
 * leave betaEnabled false until an administrator explicitly enables it.
 */
export function disableBetaOnUpgrade(team: Team): Team {
  if (!team.betaEnabled) {
    return team;
  }

  return Object.freeze({ ...team, betaEnabled: false });
}
