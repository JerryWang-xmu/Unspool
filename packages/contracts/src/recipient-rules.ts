import {
  boolean,
  integer,
  object,
  objectArray,
  text,
  textArray,
} from "../../domain/src/validation.js";

export const MODEL_RETENTION_POLICIES = [
  "zero_retention",
  "provider_default",
  "custom_reviewed",
] as const;

export type ModelRetentionPolicy = (typeof MODEL_RETENTION_POLICIES)[number];

/** A concrete model recipient; provider, model, region, and retention all bind. */
export interface ModelRecipient {
  providerId: string;
  modelId: string;
  region: string;
  retentionPolicy: ModelRetentionPolicy;
}

/**
 * Cache permissions are independent from content rights. Both switches default
 * to false and a retention of zero means no persisted copy.
 */
export interface CachePolicy {
  centralCache: boolean;
  offlineRead: boolean;
  retentionSeconds: number;
  maxBytes?: number | undefined;
}

/** Defines who may receive data and which retention policy applies. */
export interface RecipientRules {
  members: string[];
  models: ModelRecipient[];
  targetDomains: string[];
  publicTimeline: boolean;
  cache: CachePolicy;
}

export interface RecipientRulesReduction {
  members?: readonly string[];
  models?: readonly ModelRecipient[];
  targetDomains?: readonly string[];
  publicTimeline?: boolean;
  cache?: Partial<CachePolicy>;
}

/** Federated Beta starts with no recipients and no cache. */
export const DEFAULT_CACHE_POLICY: Readonly<CachePolicy> = Object.freeze({
  centralCache: false,
  offlineRead: false,
  retentionSeconds: 0,
});

export const DEFAULT_RECIPIENT_RULES: Readonly<RecipientRules> = Object.freeze({
  members: [],
  models: [],
  targetDomains: [],
  publicTimeline: false,
  cache: DEFAULT_CACHE_POLICY,
});

function uniqueTextArray(value: unknown, name: string): string[] {
  const values = textArray(value, name).map((item, index) => text(item, `${name}[${index}]`));
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${name} must not contain duplicates`);
  }
  return values;
}

function optionalInteger(value: unknown, name: string, minimum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integer(value, name, minimum);
}

function recipientKey(recipient: ModelRecipient): string {
  return [
    recipient.providerId,
    recipient.modelId,
    recipient.region,
    recipient.retentionPolicy,
  ].join("\u0000");
}

function assertUniqueRecipients(recipients: ModelRecipient[], name: string): void {
  const keys = recipients.map(recipientKey);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(`${name} must not contain duplicate model recipients`);
  }
}

export function parseModelRecipient(value: unknown, name = "ModelRecipient"): ModelRecipient {
  const input = object(value, name);
  const retentionPolicy = text(input.retentionPolicy, `${name}.retentionPolicy`);
  if (!MODEL_RETENTION_POLICIES.includes(retentionPolicy as ModelRetentionPolicy)) {
    throw new TypeError(`Unsupported ${name}.retentionPolicy: ${retentionPolicy}`);
  }

  return {
    providerId: text(input.providerId, `${name}.providerId`),
    modelId: text(input.modelId, `${name}.modelId`),
    region: text(input.region, `${name}.region`),
    retentionPolicy: retentionPolicy as ModelRetentionPolicy,
  };
}

export function parseCachePolicy(value: unknown): CachePolicy {
  const input = object(value, "CachePolicy");
  const maxBytes = optionalInteger(input.maxBytes, "CachePolicy.maxBytes", 0);

  return {
    centralCache:
      input.centralCache === undefined || input.centralCache === null
        ? false
        : boolean(input.centralCache, "CachePolicy.centralCache"),
    offlineRead:
      input.offlineRead === undefined || input.offlineRead === null
        ? false
        : boolean(input.offlineRead, "CachePolicy.offlineRead"),
    retentionSeconds:
      input.retentionSeconds === undefined || input.retentionSeconds === null
        ? 0
        : integer(input.retentionSeconds, "CachePolicy.retentionSeconds", 0),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  };
}

/**
 * Parses recipient rules with default-deny semantics: omitted collections are
 * empty and an omitted cache policy grants neither central nor offline access.
 */
export function parseRecipientRules(value: unknown): RecipientRules {
  const input = object(value, "RecipientRules");
  const models =
    input.models === undefined || input.models === null
      ? []
      : objectArray(input.models, "RecipientRules.models").map((model, index) =>
          parseModelRecipient(model, `RecipientRules.models[${index}]`),
        );
  assertUniqueRecipients(models, "RecipientRules.models");

  return {
    members:
      input.members === undefined || input.members === null
        ? []
        : uniqueTextArray(input.members, "RecipientRules.members"),
    models,
    targetDomains:
      input.targetDomains === undefined || input.targetDomains === null
        ? []
        : uniqueTextArray(input.targetDomains, "RecipientRules.targetDomains"),
    publicTimeline:
      input.publicTimeline === undefined || input.publicTimeline === null
        ? false
        : boolean(input.publicTimeline, "RecipientRules.publicTimeline"),
    cache:
      input.cache === undefined || input.cache === null
        ? parseCachePolicy({})
        : parseCachePolicy(input.cache),
  };
}

/** Applies a cache reduction; neither storage switch nor retention may grow. */
export function reduceCachePolicy(
  current: CachePolicy,
  requested: Partial<CachePolicy>,
): CachePolicy {
  const result = parseCachePolicy(current);
  const reduction = object(requested, "CachePolicy.reduction");

  if (reduction.centralCache !== undefined) {
    const centralCache = boolean(reduction.centralCache, "CachePolicy.reduction.centralCache");
    if (centralCache && !result.centralCache) {
      throw new TypeError("CachePolicy.centralCache cannot be expanded by a reduction");
    }
    result.centralCache = centralCache;
  }

  if (reduction.offlineRead !== undefined) {
    const offlineRead = boolean(reduction.offlineRead, "CachePolicy.reduction.offlineRead");
    if (offlineRead && !result.offlineRead) {
      throw new TypeError("CachePolicy.offlineRead cannot be expanded by a reduction");
    }
    result.offlineRead = offlineRead;
  }

  if (reduction.retentionSeconds !== undefined) {
    const retentionSeconds = integer(
      reduction.retentionSeconds,
      "CachePolicy.reduction.retentionSeconds",
      0,
    );
    if (retentionSeconds > result.retentionSeconds) {
      throw new TypeError("CachePolicy.retentionSeconds cannot be expanded by a reduction");
    }
    result.retentionSeconds = retentionSeconds;
  }

  if (reduction.maxBytes !== undefined) {
    const maxBytes = integer(reduction.maxBytes, "CachePolicy.reduction.maxBytes", 0);
    if (result.maxBytes !== undefined && maxBytes > result.maxBytes) {
      throw new TypeError("CachePolicy.maxBytes cannot be expanded by a reduction");
    }
    result.maxBytes = maxBytes;
  }

  return result;
}

function assertSubset(next: readonly string[], previous: readonly string[], name: string): void {
  const allowed = new Set(previous);
  for (const item of next) {
    if (!allowed.has(item)) {
      throw new TypeError(`${name} cannot add recipients during a reduction`);
    }
  }
}

function assertRecipientsSubset(
  next: readonly ModelRecipient[],
  previous: readonly ModelRecipient[],
): void {
  const allowed = new Set(previous.map(recipientKey));
  for (const recipient of next) {
    if (!allowed.has(recipientKey(recipient))) {
      throw new TypeError("RecipientRules.models cannot add recipients during a reduction");
    }
  }
}

export function assertCachePolicyNotExpanded(previous: CachePolicy, next: CachePolicy): void {
  if (next.centralCache && !previous.centralCache) {
    throw new TypeError("CachePolicy.centralCache cannot be expanded");
  }
  if (next.offlineRead && !previous.offlineRead) {
    throw new TypeError("CachePolicy.offlineRead cannot be expanded");
  }
  if (next.retentionSeconds > previous.retentionSeconds) {
    throw new TypeError("CachePolicy.retentionSeconds cannot be expanded");
  }
  if (
    next.maxBytes !== undefined &&
    (previous.maxBytes === undefined || next.maxBytes > previous.maxBytes)
  ) {
    throw new TypeError("CachePolicy.maxBytes cannot be expanded");
  }
}

/** Applies a recipient reduction. Arrays are replaced by verified subsets. */
export function reduceRecipientRules(
  current: RecipientRules,
  requested: RecipientRulesReduction,
): RecipientRules {
  const result = parseRecipientRules(current);
  const reduction = object(requested, "RecipientRules.reduction");

  if (reduction.members !== undefined) {
    const members = uniqueTextArray(reduction.members, "RecipientRules.reduction.members");
    assertSubset(members, result.members, "RecipientRules.members");
    result.members = members;
  }

  if (reduction.models !== undefined) {
    const models = objectArray(reduction.models, "RecipientRules.reduction.models").map(
      (model, index) => parseModelRecipient(model, `RecipientRules.reduction.models[${index}]`),
    );
    assertUniqueRecipients(models, "RecipientRules.reduction.models");
    assertRecipientsSubset(models, result.models);
    result.models = models;
  }

  if (reduction.targetDomains !== undefined) {
    const targetDomains = uniqueTextArray(
      reduction.targetDomains,
      "RecipientRules.reduction.targetDomains",
    );
    assertSubset(targetDomains, result.targetDomains, "RecipientRules.targetDomains");
    result.targetDomains = targetDomains;
  }

  if (reduction.publicTimeline !== undefined) {
    const publicTimeline = boolean(
      reduction.publicTimeline,
      "RecipientRules.reduction.publicTimeline",
    );
    if (publicTimeline && !result.publicTimeline) {
      throw new TypeError("RecipientRules.publicTimeline cannot be expanded by a reduction");
    }
    result.publicTimeline = publicTimeline;
  }

  if (reduction.cache !== undefined && reduction.cache !== null) {
    result.cache = reduceCachePolicy(result.cache, reduction.cache);
  }

  return result;
}

/** Ensures a replacement recipient set is not broader than the previous set. */
export function assertRecipientRulesNotExpanded(
  previous: RecipientRules,
  next: RecipientRules,
): void {
  const before = parseRecipientRules(previous);
  const after = parseRecipientRules(next);

  assertSubset(after.members, before.members, "RecipientRules.members");
  assertRecipientsSubset(after.models, before.models);
  assertSubset(after.targetDomains, before.targetDomains, "RecipientRules.targetDomains");

  if (after.publicTimeline && !before.publicTimeline) {
    throw new TypeError("RecipientRules.publicTimeline cannot be expanded");
  }

  assertCachePolicyNotExpanded(before.cache, after.cache);
}
