export const RUNNER_SUPPORT_STATES = ["supported", "limited", "unsupported"] as const;
export type RunnerSupportState = (typeof RUNNER_SUPPORT_STATES)[number];

export const RUNNER_CAPABILITIES = [
  "health_discovery",
  "personal_workspace",
  "artifact_upload",
] as const;
export type RunnerCapability = (typeof RUNNER_CAPABILITIES)[number];

export interface RunnerCapabilities {
  readonly runnerVersion: string;
  readonly schemaVersion: number;
  readonly capabilities: string[];
  readonly supportState: RunnerSupportState;
  readonly supportedPlatforms: string[];
  readonly maxUploadBytes: number;
  readonly maxActiveRunsPerWorkspace: 1;
  readonly maxWorkers: number;
  readonly maxContributorNodesPerWorkspace: number;
  readonly maxActiveGrantsPerWorkspace: number;
  readonly stableTrack: "stable" | "beta";
}

export const DEFAULT_RUNNER_CAPABILITIES: RunnerCapabilities = {
  runnerVersion: "0.1.0",
  schemaVersion: 1,
  capabilities: [...RUNNER_CAPABILITIES],
  supportState: "supported",
  supportedPlatforms: ["ubuntu-24.04-x86_64"],
  maxUploadBytes: 20 * 1024 * 1024,
  maxActiveRunsPerWorkspace: 1,
  maxWorkers: 2,
  maxContributorNodesPerWorkspace: 5,
  maxActiveGrantsPerWorkspace: 20,
  stableTrack: "stable",
};

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PLATFORM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

function assertUniqueSafeValues(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new TypeError(`${field} must not contain duplicates.`);
    }
    seen.add(value);
  }
}

function freezeCapabilities(capabilities: RunnerCapabilities): RunnerCapabilities {
  return {
    ...capabilities,
    capabilities: [...capabilities.capabilities],
    supportedPlatforms: [...capabilities.supportedPlatforms],
  };
}

/**
 * Produces the deployment limits advertised by discovery. Values are validated
 * here so a malformed override cannot publish a negative upload limit or an
 * unsafe capability name.
 */
export function buildRunnerCapabilities(
  overrides: Partial<RunnerCapabilities> = {},
): RunnerCapabilities {
  const capabilities: RunnerCapabilities = {
    ...DEFAULT_RUNNER_CAPABILITIES,
    ...overrides,
    capabilities: overrides.capabilities ?? DEFAULT_RUNNER_CAPABILITIES.capabilities,
    supportedPlatforms:
      overrides.supportedPlatforms ?? DEFAULT_RUNNER_CAPABILITIES.supportedPlatforms,
  };

  if (!VERSION_PATTERN.test(capabilities.runnerVersion)) {
    throw new TypeError("Runner version must be a short version token.");
  }
  assertPositiveInteger(capabilities.schemaVersion, "Runner schemaVersion");
  if (!RUNNER_SUPPORT_STATES.includes(capabilities.supportState)) {
    throw new TypeError("Runner supportState is not supported.");
  }
  if (capabilities.capabilities.length === 0) {
    throw new TypeError("Runner capabilities must not be empty.");
  }
  for (const capability of capabilities.capabilities) {
    if (!CAPABILITY_PATTERN.test(capability)) {
      throw new TypeError("Runner capabilities must be safe lowercase tokens.");
    }
  }
  assertUniqueSafeValues(capabilities.capabilities, "Runner capabilities");
  if (capabilities.supportedPlatforms.length === 0) {
    throw new TypeError("Runner supportedPlatforms must not be empty.");
  }
  for (const platform of capabilities.supportedPlatforms) {
    if (!PLATFORM_PATTERN.test(platform)) {
      throw new TypeError("Runner supportedPlatforms must be safe platform tokens.");
    }
  }
  assertUniqueSafeValues(capabilities.supportedPlatforms, "Runner supportedPlatforms");
  assertPositiveInteger(capabilities.maxUploadBytes, "Runner maxUploadBytes");
  if (capabilities.maxActiveRunsPerWorkspace !== 1) {
    throw new RangeError("Runner maxActiveRunsPerWorkspace must be 1.");
  }
  assertPositiveInteger(capabilities.maxWorkers, "Runner maxWorkers");
  assertNonNegativeInteger(
    capabilities.maxContributorNodesPerWorkspace,
    "Runner maxContributorNodesPerWorkspace",
  );
  assertNonNegativeInteger(
    capabilities.maxActiveGrantsPerWorkspace,
    "Runner maxActiveGrantsPerWorkspace",
  );
  if (capabilities.stableTrack !== "stable" && capabilities.stableTrack !== "beta") {
    throw new TypeError("Runner stableTrack must be stable or beta.");
  }

  return freezeCapabilities(capabilities);
}
