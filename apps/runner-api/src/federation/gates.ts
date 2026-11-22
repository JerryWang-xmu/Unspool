export const FEDERATION_LEVELS = [
  "disabled",
  "snapshot",
  "snapshot_tools",
  "snapshot_tools_patch",
] as const;
export type FederationLevel = (typeof FEDERATION_LEVELS)[number];

export interface FederationGates {
  readonly globalLevel: FederationLevel;
  readonly teamLevel?: FederationLevel | undefined;
  readonly workspaceLevel?: FederationLevel | undefined;
  readonly nodeLevel?: FederationLevel | undefined;
}

function rank(level: FederationLevel): number {
  return FEDERATION_LEVELS.indexOf(level);
}

export function effectiveFederationLevel(gates: FederationGates): FederationLevel {
  let effective = gates.globalLevel;
  for (const candidate of [gates.teamLevel, gates.workspaceLevel, gates.nodeLevel]) {
    if (candidate !== undefined && rank(candidate) < rank(effective)) effective = candidate;
  }
  return effective;
}

export function federationAllows(
  gates: FederationGates,
  required: Exclude<FederationLevel, "disabled">,
): boolean {
  return rank(effectiveFederationLevel(gates)) >= rank(required);
}

/** Existing enablement is never widened by a process/package upgrade. */
export function upgradeFederationLevel(
  current: FederationLevel,
  requested: FederationLevel,
): FederationLevel {
  return rank(requested) < rank(current) ? requested : current;
}

export const DEFAULT_FEDERATION_GATES: FederationGates = Object.freeze({ globalLevel: "disabled" });
