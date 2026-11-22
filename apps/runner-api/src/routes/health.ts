import { type Static, Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import {
  buildRunnerCapabilities,
  RUNNER_SUPPORT_STATES,
  type RunnerCapabilities,
} from "../capabilities.js";

export const DEPENDENCY_STATUSES = ["ok", "degraded", "unavailable"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export const DEFAULT_DEPENDENCY_TIMEOUT_MS = 1_000;

export interface DependencyHealth {
  readonly name: string;
  readonly status: DependencyStatus;
  readonly detail?: DependencyStatus | undefined;
}

export interface DependencyProbe {
  readonly name: string;
  readonly check: () => unknown | Promise<unknown>;
  readonly timeoutMs?: number | undefined;
}

export interface HealthRouteOptions {
  readonly capabilities?: Partial<RunnerCapabilities> | undefined;
  readonly dependencyProbes?: readonly DependencyProbe[] | undefined;
  readonly dependencyTimeoutMs?: number | undefined;
}

export interface HealthResponse extends RunnerCapabilities {
  readonly status: "ok" | "degraded";
  readonly service: "runner-api";
  readonly dependencies: DependencyHealth[];
}

const DEPENDENCY_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ok"), Type.Literal("degraded")]),
    service: Type.Literal("runner-api"),
    runnerVersion: Type.String({ minLength: 1, maxLength: 64 }),
    schemaVersion: Type.Integer({ minimum: 1 }),
    capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 64 })),
    supportState: Type.Union([
      Type.Literal(RUNNER_SUPPORT_STATES[0]),
      Type.Literal(RUNNER_SUPPORT_STATES[1]),
      Type.Literal(RUNNER_SUPPORT_STATES[2]),
    ]),
    supportedPlatforms: Type.Array(Type.String({ minLength: 1, maxLength: 64 })),
    maxUploadBytes: Type.Integer({ minimum: 1 }),
    maxActiveRunsPerWorkspace: Type.Literal(1),
    maxWorkers: Type.Integer({ minimum: 1 }),
    maxContributorNodesPerWorkspace: Type.Integer({ minimum: 0 }),
    maxActiveGrantsPerWorkspace: Type.Integer({ minimum: 0 }),
    stableTrack: Type.Union([Type.Literal("stable"), Type.Literal("beta")]),
    dependencies: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 64 }),
          status: Type.Union([
            Type.Literal("ok"),
            Type.Literal("degraded"),
            Type.Literal("unavailable"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type HealthResponseBody = Static<typeof HealthResponseSchema>;

function assertDependencyName(name: string): void {
  if (!DEPENDENCY_NAME_PATTERN.test(name)) {
    throw new TypeError("Dependency name must be a safe lowercase identifier.");
  }
}

function assertTimeout(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
}

function validateProbes(probes: readonly DependencyProbe[]): void {
  const seen = new Set<string>();
  for (const probe of probes) {
    assertDependencyName(probe.name);
    if (seen.has(probe.name)) {
      throw new TypeError("Dependency probes must have unique names.");
    }
    seen.add(probe.name);
    if (probe.timeoutMs !== undefined) {
      assertTimeout(probe.timeoutMs, `Dependency probe ${probe.name} timeoutMs`);
    }
  }
}

function normalizeProbeResult(result: unknown): DependencyStatus {
  switch (result) {
    case undefined:
    case true:
    case "ok":
      return "ok";
    case "degraded":
      return "degraded";
    case false:
    case "unavailable":
      return "unavailable";
    default:
      return "unavailable";
  }
}

async function runProbe(
  probe: DependencyProbe,
  defaultTimeoutMs: number,
): Promise<DependencyHealth> {
  const timeoutMs = probe.timeoutMs ?? defaultTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => probe.check()),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Dependency probe timed out."));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    return { name: probe.name, status: normalizeProbeResult(result) };
  } catch {
    return { name: probe.name, status: "unavailable" };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Runs probes concurrently and reduces every failure to a status. Probe errors
 * are deliberately discarded so paths, credentials, and dependency internals
 * cannot cross the public health boundary.
 */
export async function checkDependencies(
  probes: readonly DependencyProbe[],
  defaultTimeoutMs = DEFAULT_DEPENDENCY_TIMEOUT_MS,
): Promise<DependencyHealth[]> {
  validateProbes(probes);
  assertTimeout(defaultTimeoutMs, "dependencyTimeoutMs");
  return Promise.all(probes.map((probe) => runProbe(probe, defaultTimeoutMs)));
}

export function getHealthStatus(
  dependencies: readonly (
    | DependencyHealth
    | { readonly name: string; readonly healthy: boolean; readonly detail?: string | undefined }
  )[] = [],
  overrides: Partial<RunnerCapabilities> = {},
): HealthResponse {
  const capabilities = buildRunnerCapabilities(overrides);
  const normalized = dependencies.map((dependency) => {
    const status =
      "status" in dependency ? dependency.status : dependency.healthy ? "ok" : "unavailable";
    const detail = DEPENDENCY_STATUSES.includes(dependency.detail as DependencyStatus)
      ? (dependency.detail as DependencyStatus)
      : undefined;
    return { name: dependency.name, status, ...(detail === undefined ? {} : { detail }) };
  });
  const dependenciesHealthy = normalized.every((dependency) => dependency.status === "ok");

  return {
    ...capabilities,
    status: dependenciesHealthy ? "ok" : "degraded",
    service: "runner-api",
    dependencies: normalized,
  };
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions = {}): void {
  const probes = options.dependencyProbes ?? [];
  const defaultTimeoutMs = options.dependencyTimeoutMs ?? DEFAULT_DEPENDENCY_TIMEOUT_MS;
  validateProbes(probes);
  assertTimeout(defaultTimeoutMs, "dependencyTimeoutMs");

  const handler = async (): Promise<HealthResponseBody> => {
    const dependencies = await checkDependencies(probes, defaultTimeoutMs);
    return getHealthStatus(dependencies, options.capabilities);
  };

  for (const path of ["/healthz", "/health", "/v1/health"] as const) {
    app.get(
      path,
      {
        schema: {
          response: {
            200: HealthResponseSchema,
          },
        },
      },
      handler,
    );
  }
}
