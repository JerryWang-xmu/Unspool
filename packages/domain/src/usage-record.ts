const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COST_CURRENCY_PATTERN = /^[A-Z]{3}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuidV7 = (value: unknown): value is string =>
  typeof value === "string" && UUID_V7_PATTERN.test(value);

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const optionalNonNegativeInteger = (value: unknown, field: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`UsageRecord.${field} must be a non-negative integer`);
  }
  return value;
};

const optionalNonNegativeNumber = (value: unknown, field: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`UsageRecord.${field} must be a non-negative number`);
  }
  return value;
};

export const USAGE_RELIABILITIES = ["reliable", "unavailable"] as const;
export type UsageReliability = (typeof USAGE_RELIABILITIES)[number];

export interface UsageRecord {
  readonly runId: string;
  readonly provider: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costAmount?: number;
  readonly costCurrency?: string;
  readonly reliability: UsageReliability;
}

export function parseUsageRecord(value: unknown): UsageRecord {
  if (!isRecord(value)) {
    throw new TypeError("UsageRecord must be an object");
  }

  const { runId, provider, reliability } = value;
  if (!isUuidV7(runId)) {
    throw new TypeError("UsageRecord.runId must be a UUIDv7 string");
  }
  if (typeof provider !== "string" || provider.trim().length === 0) {
    throw new TypeError("UsageRecord.provider must be a non-empty string");
  }
  if (!isOneOf(reliability, USAGE_RELIABILITIES)) {
    throw new TypeError("UsageRecord.reliability must be reliable or unavailable");
  }

  const inputTokens = optionalNonNegativeInteger(value.inputTokens, "inputTokens");
  const outputTokens = optionalNonNegativeInteger(value.outputTokens, "outputTokens");
  const costAmount = optionalNonNegativeNumber(value.costAmount, "costAmount");
  const costCurrency = value.costCurrency;
  if (
    costCurrency !== undefined &&
    (typeof costCurrency !== "string" || !COST_CURRENCY_PATTERN.test(costCurrency))
  ) {
    throw new TypeError("UsageRecord.costCurrency must be a three-letter uppercase currency code");
  }
  if ((costAmount === undefined) !== (costCurrency === undefined)) {
    throw new TypeError("UsageRecord.costAmount and costCurrency must be provided together");
  }
  if (
    reliability === "unavailable" &&
    (inputTokens !== undefined ||
      outputTokens !== undefined ||
      costAmount !== undefined ||
      costCurrency !== undefined)
  ) {
    throw new TypeError("UsageRecord fields must be absent when reliability is unavailable");
  }

  return Object.freeze({
    runId,
    provider,
    reliability,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costAmount === undefined ? {} : { costAmount }),
    ...(costCurrency === undefined ? {} : { costCurrency }),
  });
}
