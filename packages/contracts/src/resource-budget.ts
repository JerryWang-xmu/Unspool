import { integer, object } from "../../domain/src/validation.js";

export const RESOURCE_BUDGET_LIMITS = [
  "maxFiles",
  "maxBytes",
  "maxReadBytes",
  "maxOutputBytes",
  "maxDurationSeconds",
  "maxConcurrent",
  "cpuMillicpu",
  "memoryMb",
  "processes",
] as const;

export type ResourceBudgetLimit = (typeof RESOURCE_BUDGET_LIMITS)[number];

/** Strict upper bounds for one fixed-tool or federated operation. */
export interface ResourceBudget {
  maxFiles: number;
  maxBytes: number;
  maxReadBytes: number;
  maxOutputBytes: number;
  maxDurationSeconds: number;
  maxConcurrent: number;
  cpuMillicpu: number;
  memoryMb: number;
  processes: number;
}

export type ResourceUsage = ResourceBudget;

/** All zero limits deny work until an owner grants explicit capacity. */
export const ZERO_RESOURCE_BUDGET: Readonly<ResourceBudget> = Object.freeze({
  maxFiles: 0,
  maxBytes: 0,
  maxReadBytes: 0,
  maxOutputBytes: 0,
  maxDurationSeconds: 0,
  maxConcurrent: 0,
  cpuMillicpu: 0,
  memoryMb: 0,
  processes: 0,
});

/** Parses a complete budget. Every limit is required and must be non-negative. */
export function parseResourceBudget(value: unknown): ResourceBudget {
  const input = object(value, "ResourceBudget");
  return {
    maxFiles: integer(input.maxFiles, "ResourceBudget.maxFiles", 0),
    maxBytes: integer(input.maxBytes, "ResourceBudget.maxBytes", 0),
    maxReadBytes: integer(input.maxReadBytes, "ResourceBudget.maxReadBytes", 0),
    maxOutputBytes: integer(input.maxOutputBytes, "ResourceBudget.maxOutputBytes", 0),
    maxDurationSeconds: integer(input.maxDurationSeconds, "ResourceBudget.maxDurationSeconds", 0),
    maxConcurrent: integer(input.maxConcurrent, "ResourceBudget.maxConcurrent", 0),
    cpuMillicpu: integer(input.cpuMillicpu, "ResourceBudget.cpuMillicpu", 0),
    memoryMb: integer(input.memoryMb, "ResourceBudget.memoryMb", 0),
    processes: integer(input.processes, "ResourceBudget.processes", 0),
  };
}

/** Builds a budget with omitted limits set to zero rather than unlimited. */
export function createResourceBudget(overrides: Partial<ResourceBudget> = {}): ResourceBudget {
  const result = { ...ZERO_RESOURCE_BUDGET };
  for (const limit of RESOURCE_BUDGET_LIMITS) {
    const value = overrides[limit];
    if (value === undefined) continue;
    result[limit] = integer(value, `ResourceBudget.${limit}`, 0);
  }
  return result;
}

/** Applies a budget reduction; a limit may be lowered but never raised. */
export function reduceResourceBudget(
  current: ResourceBudget,
  requested: Partial<ResourceBudget>,
): ResourceBudget {
  const result = parseResourceBudget(current);
  const reduction = object(requested, "ResourceBudget.reduction");

  for (const limit of RESOURCE_BUDGET_LIMITS) {
    const value = reduction[limit];
    if (value === undefined) continue;

    const narrowed = integer(value, `ResourceBudget.reduction.${limit}`, 0);
    if (narrowed > result[limit]) {
      throw new TypeError(`ResourceBudget.${limit} cannot be expanded by a reduction`);
    }
    result[limit] = narrowed;
  }

  return result;
}

/** Ensures every replacement limit is less than or equal to the previous one. */
export function assertResourceBudgetNotExpanded(
  previous: ResourceBudget,
  next: ResourceBudget,
): void {
  const before = parseResourceBudget(previous);
  const after = parseResourceBudget(next);

  for (const limit of RESOURCE_BUDGET_LIMITS) {
    if (after[limit] > before[limit]) {
      throw new TypeError(`ResourceBudget.${limit} cannot be expanded`);
    }
  }
}

/** Returns true only when every observed usage dimension is within budget. */
export function isWithinResourceBudget(usage: ResourceUsage, budget: ResourceBudget): boolean {
  const observed = parseResourceBudget(usage);
  const allowed = parseResourceBudget(budget);

  for (const limit of RESOURCE_BUDGET_LIMITS) {
    if (observed[limit] > allowed[limit]) return false;
  }
  return true;
}
