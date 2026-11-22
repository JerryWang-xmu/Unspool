import { createHash, randomUUID } from "node:crypto";
import {
  createFauxProvider,
  type FauxProvider,
  type FauxProviderOptions,
} from "./providers/faux.ts";

export interface ModelRecipient {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly region?: string;
  readonly retentionPolicy?: string;
  readonly [key: string]: unknown;
}

export interface ModelRecipientRule extends ModelRecipient {}

export interface SourceLabelLike {
  readonly id?: string;
  readonly modelRecipientRules?: readonly ModelRecipientRule[];
  readonly [key: string]: unknown;
}

export interface ModelMessage {
  readonly role?: string;
  readonly content?: unknown;
  readonly sourceLabels?: readonly (string | SourceLabelLike)[];
  readonly securityLabel?: string | SourceLabelLike;
  readonly [key: string]: unknown;
}

export interface ModelToolDeclaration {
  readonly name?: string;
  readonly sourceLabels?: readonly (string | SourceLabelLike)[];
  readonly [key: string]: unknown;
}

export interface ModelProfile {
  readonly id?: string;
  readonly profileId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly enabled?: boolean;
  readonly secretRef?: string;
  readonly region?: string;
  readonly retentionPolicy?: string;
  readonly recipient?: ModelRecipient;
  readonly allowedSourceLabels?: readonly string[];
  readonly reasoningOptions?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface ModelTicket {
  readonly ticket?: string;
  readonly token?: string;
  readonly id?: string;
  readonly profileId?: string;
  readonly provider?: string;
  readonly attemptId?: string;
  readonly attemptEpoch?: number;
  readonly expiresAt?: string | Date;
  readonly status?: string;
  readonly budget?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface IssueModelAccessTicketInput {
  readonly profileId: string;
  readonly attemptId?: string;
  readonly attemptEpoch?: number;
  readonly expiresAt?: string | Date;
  readonly budget?: Record<string, unknown>;
}

export interface IssuedModelAccessTicket {
  readonly ticket: string;
  readonly profileId: string;
  readonly provider: string;
  readonly attemptId?: string;
  readonly attemptEpoch?: number;
  readonly expiresAt: string;
  readonly budget?: Record<string, unknown>;
}

export interface CompletionRequest {
  readonly modelAccessTicket: string;
  readonly profileId: string;
  readonly purposeDigest: string;
  readonly approvedSourceLabels?: readonly (string | SourceLabelLike)[];
  readonly messages?: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDeclaration[];
  readonly attemptId?: string;
  readonly attemptEpoch?: number;
  readonly [key: string]: unknown;
}

export interface ProviderCompletionRequest {
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly profileId: string;
  readonly model: string;
  readonly purposeDigest: string;
  readonly approvedSourceLabels: readonly string[];
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDeclaration[];
  readonly signal: AbortSignal;
  readonly credential?: string;
  readonly reasoningOptions?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface ProviderStreamEvent {
  readonly type?: string;
  readonly kind?: string;
  readonly delta?: string;
  readonly text?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly arguments?: unknown;
  readonly argumentsDigest?: string;
  readonly code?: string;
  readonly message?: string;
  readonly retryable?: boolean;
  readonly finishReason?: string;
  readonly reason?: string;
  readonly usage?: ModelProviderUsage;
  readonly providerRequestId?: string;
  readonly [key: string]: unknown;
}

export interface ModelProviderUsage {
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly costAmount?: number | null;
  readonly costCurrency?: string | null;
  readonly reliability?: "reliable" | "estimated" | "unavailable";
  readonly [key: string]: unknown;
}

export interface ModelProvider {
  readonly name?: string;
  createCompletion?(request: ProviderCompletionRequest): unknown;
  stream?(request: ProviderCompletionRequest): unknown;
}

export type ProviderFunction = (request: ProviderCompletionRequest) => unknown;

export interface ModelGatewayOptions {
  readonly provider?: ModelProvider | ProviderFunction;
  readonly providers?: Readonly<Record<string, ModelProvider>>;
  readonly profiles?: readonly ModelProfile[] | Readonly<Record<string, ModelProfile>>;
  readonly profile?: ModelProfile | readonly ModelProfile[];
  readonly tickets?:
    | readonly ModelTicket[]
    | ReadonlyMap<string, ModelTicket>
    | Readonly<Record<string, ModelTicket>>;
  readonly validateTicket?: (
    ticket: string,
    request: CompletionRequest,
  ) => unknown | Promise<unknown>;
  readonly ticketValidator?: (
    ticket: string,
    request: CompletionRequest,
  ) => unknown | Promise<unknown>;
  readonly sourceLabels?:
    | readonly SourceLabelLike[]
    | ReadonlyMap<string, SourceLabelLike>
    | Readonly<Record<string, SourceLabelLike>>;
  readonly checkEgress?: (input: EgressCheckInput) => boolean | void | Promise<boolean | void>;
  readonly authorizeEgress?: (input: EgressCheckInput) => boolean | void | Promise<boolean | void>;
  readonly resolveSecretRef?: (secretRef: string) => string | Promise<string>;
  readonly secretStore?:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>
    | {
        readonly resolve?: (secretRef: string) => string | Promise<string>;
        readonly get?: (secretRef: string) => string | undefined;
      };
  readonly requireSourceLabels?: boolean;
  readonly now?: () => Date | string | number;
  readonly ticketTtlMs?: number;
  readonly defaultModel?: string;
  readonly faux?: FauxProviderOptions;
}

export interface EgressCheckInput {
  readonly profile: ModelProfile;
  readonly purposeDigest: string;
  readonly approvedSourceLabels: readonly string[];
  readonly message?: ModelMessage;
  readonly tool?: ModelToolDeclaration;
  readonly labels: readonly (string | SourceLabelLike)[];
}

export interface CompletionHandle {
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly provider: string;
  readonly model: string;
  readonly events: AsyncIterable<ModelGatewayEvent>;
  [Symbol.asyncIterator](): AsyncIterator<ModelGatewayEvent>;
}

export interface ModelTokenEvent {
  readonly type: "token";
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly delta: string;
}

export interface ModelToolCallEvent {
  readonly type: "tool_call";
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly argumentsDigest: string;
}

export interface ModelErrorEvent {
  readonly type: "error";
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ModelCancelledEvent {
  readonly type: "cancelled";
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly reason: string;
}

export interface ModelCompletedEvent {
  readonly type: "completed";
  readonly completionId: string;
  readonly attemptEpoch: number;
  readonly finishReason: string;
  readonly usage: ModelUsage;
}

export type ModelGatewayEvent =
  | ModelTokenEvent
  | ModelToolCallEvent
  | ModelErrorEvent
  | ModelCancelledEvent
  | ModelCompletedEvent;

export interface ModelUsage {
  readonly completionId: string;
  readonly provider: string;
  readonly model: string;
  readonly providerRequestId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costAmount: number | null;
  readonly costCurrency: string | null;
  readonly reliability: "reliable" | "estimated" | "unavailable";
  readonly available: boolean;
}

export interface StreamEventsInput {
  readonly completionId: string;
  readonly attemptEpoch?: number;
}

export interface CancelCompletionInput {
  readonly completionId: string;
  readonly attemptEpoch: number;
}

export interface CancelCompletionResult {
  readonly completionId: string;
  readonly cancelled: boolean;
  readonly state: string;
  readonly reason?: string;
}

export interface ModelGateway {
  issueTicket(input: IssueModelAccessTicketInput): IssuedModelAccessTicket;
  issueModelAccessTicket(input: IssueModelAccessTicketInput): IssuedModelAccessTicket;
  createCompletion(input: CompletionRequest): Promise<CompletionHandle>;
  streamEvents(input: StreamEventsInput | string): AsyncIterable<ModelGatewayEvent>;
  cancelCompletion(input: CancelCompletionInput | string): CancelCompletionResult;
  getUsage(input?: StreamEventsInput | string): ModelUsage | readonly ModelUsage[];
}

interface CompletionRecord {
  completionId: string;
  attemptEpoch: number;
  profile: ModelProfile;
  providerName: string;
  provider: ModelProvider;
  model: string;
  purposeDigest: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDeclaration[];
  approvedSourceLabels: readonly string[];
  credential?: string | undefined;
  secretValues: string[];
  controller: AbortController;
  status: "created" | "streaming" | "completed" | "cancelled" | "failed";
  streamClaimed: boolean;
  usage: ModelUsage | null;
  providerRequestId: string | null;
  cancelReason?: string | undefined;
}

const toInstant = (value: Date | string | number, label: string): number => {
  const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (!Number.isFinite(instant)) {
    throw new TypeError(`${label} is not a valid instant: ${String(value)}`);
  }

  return instant;
};

const toIso = (instant: number): string => new Date(instant).toISOString();

const assertNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return value;
};

const labelId = (label: string | SourceLabelLike): string | null => {
  if (typeof label === "string") {
    return label.length === 0 ? null : label;
  }
  return typeof label.id === "string" && label.id.length > 0 ? label.id : null;
};

const normalizeLabels = (
  input: readonly (string | SourceLabelLike)[] | undefined,
): (string | SourceLabelLike)[] => [...(input ?? [])];

const normalizeLabelRegistry = (
  input: ModelGatewayOptions["sourceLabels"],
): Map<string, SourceLabelLike> => {
  const registry = new Map<string, SourceLabelLike>();

  if (input === undefined) {
    return registry;
  }
  if (input instanceof Map) {
    for (const [key, label] of input) {
      registry.set(label.id ?? key, label);
    }
    return registry;
  }
  if (Array.isArray(input)) {
    for (const label of input) {
      if (label.id !== undefined) {
        registry.set(label.id, label);
      }
    }
    return registry;
  }

  for (const [key, label] of Object.entries(input)) {
    registry.set(label.id ?? key, label);
  }
  return registry;
};

const normalizeProfiles = (
  input: readonly ModelProfile[] | Readonly<Record<string, ModelProfile>> | undefined,
): Map<string, ModelProfile> => {
  const profiles = new Map<string, ModelProfile>();
  const withId = (id: string, profile: ModelProfile): ModelProfile =>
    profile.id === id ? profile : { ...profile, id };

  if (input === undefined) {
    return profiles;
  }
  if (Array.isArray(input)) {
    for (const profile of input) {
      const id = profile.id ?? profile.profileId;
      if (id !== undefined) {
        profiles.set(id, withId(id, profile));
      }
    }
    return profiles;
  }

  for (const [key, profile] of Object.entries(input)) {
    const id = profile.id ?? profile.profileId ?? key;
    profiles.set(id, withId(id, profile));
  }
  return profiles;
};

const normalizeTickets = (input: ModelGatewayOptions["tickets"]): Map<string, ModelTicket> => {
  const tickets = new Map<string, ModelTicket>();

  if (input === undefined) {
    return tickets;
  }
  if (input instanceof Map) {
    for (const [key, ticket] of input) {
      tickets.set(ticket.ticket ?? ticket.token ?? ticket.id ?? key, ticket);
    }
    return tickets;
  }
  if (Array.isArray(input)) {
    for (const ticket of input) {
      const key = ticket.ticket ?? ticket.token ?? ticket.id;
      if (key !== undefined) {
        tickets.set(key, ticket);
      }
    }
    return tickets;
  }

  for (const [key, ticket] of Object.entries(input)) {
    tickets.set(ticket.ticket ?? ticket.token ?? ticket.id ?? key, ticket);
  }
  return tickets;
};

const normalizeProfile = (
  profileId: string,
  profiles: Map<string, ModelProfile>,
  options: ModelGatewayOptions,
): ModelProfile => {
  const existing = profiles.get(profileId);
  if (existing !== undefined) {
    return existing;
  }

  if (profiles.size === 0) {
    return {
      id: profileId,
      provider: "faux",
      model: options.defaultModel ?? "faux",
      enabled: true,
    };
  }

  throw new Error(`Unknown model profile: ${profileId}`);
};

const profileProviderName = (profile: ModelProfile): string => profile.provider ?? "faux";

const profileModel = (profile: ModelProfile, options: ModelGatewayOptions): string =>
  profile.model ?? options.defaultModel ?? "faux";

const recipientFor = (
  profile: ModelProfile,
  model: string,
): {
  readonly providerId: string;
  readonly modelId: string;
  readonly region: string | undefined;
  readonly retentionPolicy: string | undefined;
} => ({
  providerId: profile.recipient?.providerId ?? profileProviderName(profile),
  modelId: profile.recipient?.modelId ?? model,
  region: profile.recipient?.region ?? profile.region,
  retentionPolicy: profile.recipient?.retentionPolicy ?? profile.retentionPolicy,
});

const valueMatches = (ruleValue: unknown, actual: string | undefined): boolean =>
  ruleValue === undefined || ruleValue === "*" || ruleValue === actual;

const recipientRuleMatches = (
  rule: ModelRecipientRule,
  recipient: ReturnType<typeof recipientFor>,
): boolean =>
  valueMatches(rule.providerId, recipient.providerId) &&
  valueMatches(rule.modelId, recipient.modelId) &&
  valueMatches(rule.region, recipient.region) &&
  valueMatches(rule.retentionPolicy, recipient.retentionPolicy);

const messageLabels = (message: ModelMessage): (string | SourceLabelLike)[] => {
  const labels = normalizeLabels(message.sourceLabels);

  if (typeof message.securityLabel === "string") {
    labels.push(message.securityLabel);
  } else if (message.securityLabel !== undefined) {
    labels.push(message.securityLabel);
  }

  return labels;
};

const toolLabels = (tool: ModelToolDeclaration): (string | SourceLabelLike)[] =>
  normalizeLabels(tool.sourceLabels);

const usageUnavailable = (
  completionId: string,
  provider: string,
  model: string,
  providerRequestId: string | null,
): ModelUsage => ({
  completionId,
  provider,
  model,
  providerRequestId,
  inputTokens: null,
  outputTokens: null,
  costAmount: null,
  costCurrency: null,
  reliability: "unavailable",
  available: false,
});

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const normalizeUsage = (
  raw: ModelProviderUsage | undefined,
  completionId: string,
  provider: string,
  model: string,
  providerRequestId: string | null,
): ModelUsage => {
  if (raw === undefined) {
    return usageUnavailable(completionId, provider, model, providerRequestId);
  }

  const hasNumbers =
    raw.inputTokens !== undefined || raw.outputTokens !== undefined || raw.costAmount !== undefined;
  const reliability =
    raw.reliability === "reliable" || raw.reliability === "estimated"
      ? raw.reliability
      : raw.reliability === "unavailable" || !hasNumbers
        ? "unavailable"
        : "reliable";

  if (reliability === "unavailable") {
    return usageUnavailable(completionId, provider, model, providerRequestId);
  }

  const inputTokens = finiteNonNegative(raw.inputTokens);
  const outputTokens = finiteNonNegative(raw.outputTokens);
  const costAmount = finiteNonNegative(raw.costAmount);
  const costCurrency =
    typeof raw.costCurrency === "string" && raw.costCurrency.length > 0 ? raw.costCurrency : null;

  return {
    completionId,
    provider,
    model,
    providerRequestId,
    inputTokens,
    outputTokens,
    costAmount,
    costCurrency,
    reliability,
    available: inputTokens !== null || outputTokens !== null || costAmount !== null,
  };
};

const digestOf = (value: unknown): string => {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value === undefined ? null : value);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
};

const sanitizeError = (error: unknown, secretValues: readonly string[]): string => {
  let message = error instanceof Error ? error.message : String(error);

  for (const secret of secretValues) {
    if (secret.length > 0) {
      message = message.split(secret).join("[secret]");
    }
  }

  return message.slice(0, 500);
};

const eventType = (event: ProviderStreamEvent): string | null => {
  const raw = event.type ?? event.kind;
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "token":
    case "text":
    case "text_delta":
    case "output_delta":
      return "token";
    case "tool_call":
    case "toolCall":
      return "tool_call";
    case "error":
      return "error";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "completed":
    case "completion":
    case "done":
    case "finish":
      return "completed";
    default:
      return raw;
  }
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" &&
  value !== null &&
  Symbol.asyncIterator in value &&
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";

const isIterable = (value: unknown): value is Iterable<unknown> =>
  typeof value === "object" &&
  value !== null &&
  Symbol.iterator in value &&
  typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function";

const asAsyncIterator = async <T>(source: unknown): Promise<AsyncIterator<T>> => {
  const resolved = await source;

  if (isAsyncIterable(resolved)) {
    return resolved[Symbol.asyncIterator]() as AsyncIterator<T>;
  }
  if (isIterable(resolved)) {
    const iterable = resolved as Iterable<T>;
    return (async function* bridgeIterator(): AsyncGenerator<T> {
      yield* iterable;
    })()[Symbol.asyncIterator]();
  }
  if (typeof resolved === "object" && resolved !== null) {
    const container = resolved as {
      readonly events?: unknown;
      readonly stream?: unknown;
      readonly chunks?: unknown;
    };
    const nested = container.events ?? container.stream ?? container.chunks;
    if (nested !== undefined) {
      return asAsyncIterator<T>(nested);
    }
  }

  throw new Error("Model provider did not return an event stream");
};

const nextOrAbort = async <T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<
  { readonly kind: "next"; readonly result: IteratorResult<T> } | { readonly kind: "aborted" }
> => {
  if (signal.aborted) {
    return { kind: "aborted" };
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => resolve({ kind: "aborted" }));

    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => finish(() => resolve({ kind: "next", result })),
      (error: unknown) => finish(() => reject(error)),
    );
  });
};

const closeIterator = <T>(iterator: AsyncIterator<T>): void => {
  try {
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  } catch {
    // A provider that cannot close its iterator is already being abandoned.
  }
};

export function createModelGateway(options: ModelGatewayOptions = {}): ModelGateway {
  const profiles = normalizeProfiles(
    options.profiles ??
      (options.profile === undefined
        ? undefined
        : Array.isArray(options.profile)
          ? options.profile
          : [options.profile]),
  );
  const tickets = normalizeTickets(options.tickets);
  const labelRegistry = normalizeLabelRegistry(options.sourceLabels);
  const providers = new Map<string, ModelProvider>(Object.entries(options.providers ?? {}));
  const now = options.now ?? (() => new Date());
  const ticketTtlMs = options.ticketTtlMs ?? 5 * 60_000;
  const defaultFauxProvider: FauxProvider = createFauxProvider(options.faux);
  const completions = new Map<string, CompletionRecord>();

  if (options.provider !== undefined) {
    if (typeof options.provider === "function") {
      providers.set("faux", { name: "faux", createCompletion: options.provider });
    } else {
      providers.set(options.provider.name ?? "faux", options.provider);
    }
  }
  if (!providers.has("faux")) {
    providers.set("faux", defaultFauxProvider);
  }

  const fallbackProvider = providers.size === 1 ? providers.values().next().value : undefined;

  const clock = (): number => toInstant(now(), "gateway clock");

  const providerFor = (name: string): ModelProvider => {
    const provider =
      providers.get(name) ?? (fallbackProvider?.name === name ? fallbackProvider : undefined);
    if (provider === undefined) {
      throw new Error(`Unsupported model provider: ${name}`);
    }
    return provider;
  };

  const resolveSecret = async (secretRef: string | undefined): Promise<string | undefined> => {
    if (secretRef === undefined) {
      return undefined;
    }

    let secret: string | undefined;
    if (options.resolveSecretRef !== undefined) {
      secret = await options.resolveSecretRef(secretRef);
    } else if (options.secretStore instanceof Map) {
      secret = options.secretStore.get(secretRef);
    } else if (options.secretStore !== undefined) {
      const store = options.secretStore as {
        readonly resolve?: (value: string) => string | Promise<string>;
        readonly get?: (value: string) => string | undefined;
        readonly [key: string]: unknown;
      };
      if (typeof store.resolve === "function") {
        secret = await store.resolve(secretRef);
      } else if (typeof store.get === "function") {
        secret = store.get(secretRef);
      } else if (typeof store[secretRef] === "string") {
        secret = store[secretRef] as string;
      }
    }

    if (secret === undefined || secret.length === 0) {
      return undefined;
    }
    return secret;
  };

  const resolveTicket = async (
    request: CompletionRequest,
    profile: ModelProfile,
    providerName: string,
    attemptEpoch: number | undefined,
  ): Promise<number | undefined> => {
    const ticketValue = assertNonEmptyString(request.modelAccessTicket, "modelAccessTicket");
    const validator = options.validateTicket ?? options.ticketValidator;
    let claims: Record<string, unknown> | null = null;

    if (validator !== undefined) {
      const result = await validator(ticketValue, request);
      if (result === false || result === null) {
        throw new Error("Invalid model access ticket");
      }
      if (typeof result === "object") {
        claims = result as Record<string, unknown>;
      }
    }

    const ticket = tickets.get(ticketValue);
    if (tickets.size > 0 && ticket === undefined) {
      throw new Error("Invalid model access ticket");
    }

    const effective = ticket ?? claims;
    if (effective !== undefined && effective !== null) {
      const status = effective.status;
      if (
        typeof status === "string" &&
        status !== "active" &&
        status !== "issued" &&
        status !== "valid"
      ) {
        throw new Error(`Model access ticket is ${status}`);
      }

      if (typeof effective.profileId === "string" && effective.profileId !== profile.id) {
        throw new Error("Model access ticket does not permit this profile");
      }
      if (typeof effective.provider === "string" && effective.provider !== providerName) {
        throw new Error("Model access ticket does not permit this provider");
      }

      const ticketEpoch = effective.attemptEpoch;
      if (ticketEpoch !== undefined) {
        if (!Number.isInteger(ticketEpoch) || (ticketEpoch as number) < 0) {
          throw new Error("Model access ticket attempt epoch is invalid");
        }
        if (attemptEpoch !== undefined && attemptEpoch !== ticketEpoch) {
          throw new Error(
            `Attempt epoch mismatch for model access ticket: ` +
              `${String(attemptEpoch)} vs ${String(ticketEpoch)}`,
          );
        }
      }

      if (effective.expiresAt !== undefined) {
        const expiresAt = toInstant(
          effective.expiresAt as string | Date | number,
          "model access ticket expiry",
        );
        if (expiresAt <= clock()) {
          throw new Error("Model access ticket expired");
        }
      }

      if (typeof ticketEpoch === "number") {
        return attemptEpoch ?? ticketEpoch;
      }
    }

    return attemptEpoch;
  };

  const assertEgress = async (
    profile: ModelProfile,
    request: CompletionRequest,
    approvedSourceLabels: readonly string[],
  ): Promise<void> => {
    const approved = new Set(approvedSourceLabels);
    const allowAll = approved.has("*");
    const recipient = recipientFor(profile, profileModel(profile, options));
    const callback = options.checkEgress ?? options.authorizeEgress;

    const inspect = async (
      labels: readonly (string | SourceLabelLike)[],
      message?: ModelMessage,
      tool?: ModelToolDeclaration,
    ): Promise<void> => {
      if (labels.length === 0 && options.requireSourceLabels === true) {
        throw new Error("Model egress denied: content has no source label") | undefined;
      }

      for (const label of labels) {
        const id = labelId(label);
        if (!allowAll && (id === null || !approved.has(id))) {
          throw new Error(
            `Model egress denied: source label ${id ?? "<unlabelled>"} is not approved`,
          );
        }

        const definition = typeof label === "object" ? label : labelRegistry.get(id ?? "");
        const rules = definition?.modelRecipientRules;

        if (rules !== undefined) {
          if (
            !Array.isArray(rules) ||
            !rules.some((rule) => recipientRuleMatches(rule, recipient))
          ) {
            throw new Error(
              `Model egress denied: source label ${id ?? "<unlabelled>"} does not permit ` +
                `recipient ${recipient.providerId}/${recipient.modelId}`,
            );
          }
        }
      }

      if (callback !== undefined) {
        const verdict = await callback({
          profile,
          purposeDigest: request.purposeDigest,
          approvedSourceLabels,
          ...(message === undefined ? {} : { message }),
          ...(tool === undefined ? {} : { tool }),
          labels,
        });
        if (verdict === false) {
          throw new Error("Model egress denied by policy");
        }
      }
    };

    for (const message of request.messages ?? []) {
      await inspect(messageLabels(message), message);
    }
    for (const tool of request.tools ?? []) {
      await inspect(toolLabels(tool), undefined, tool);
    }
  };

  const gateway: ModelGateway = {
    issueTicket(input: IssueModelAccessTicketInput): IssuedModelAccessTicket {
      const profileId = assertNonEmptyString(input.profileId, "profileId");
      const profile = normalizeProfile(profileId, profiles, options);
      const expiresAt =
        input.expiresAt === undefined
          ? toIso(clock() + ticketTtlMs)
          : toIso(toInstant(input.expiresAt, "ticket expiry"));

      if (toInstant(expiresAt, "ticket expiry") <= clock()) {
        throw new Error("Model access ticket expiry must be in the future");
      }
      if (
        input.attemptEpoch !== undefined &&
        (!Number.isInteger(input.attemptEpoch) || input.attemptEpoch < 0)
      ) {
        throw new Error("attemptEpoch must be a non-negative integer");
      }

      const ticket = `mat_${randomUUID()}`;
      const record: ModelTicket = {
        ticket,
        profileId,
        provider: profileProviderName(profile),
        ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
        ...(input.attemptEpoch === undefined ? {} : { attemptEpoch: input.attemptEpoch }),
        expiresAt,
        status: "active",
        ...(input.budget === undefined ? {} : { budget: input.budget }),
      };
      tickets.set(ticket, record);

      return {
        ticket,
        profileId,
        provider: profileProviderName(profile),
        ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
        ...(input.attemptEpoch === undefined ? {} : { attemptEpoch: input.attemptEpoch }),
        expiresAt,
        ...(input.budget === undefined ? {} : { budget: input.budget }),
      };
    },

    issueModelAccessTicket(input: IssueModelAccessTicketInput): IssuedModelAccessTicket {
      return gateway.issueTicket(input);
    },

    async createCompletion(input: CompletionRequest): Promise<CompletionHandle> {
      const profileId = assertNonEmptyString(input.profileId, "profileId");
      const purposeDigest = assertNonEmptyString(input.purposeDigest, "purposeDigest");
      const profile = normalizeProfile(profileId, profiles, options);
      const providerName = profileProviderName(profile);
      const provider = providerFor(providerName);

      if (profile.enabled === false) {
        throw new Error(`Model profile ${profileId} is disabled`);
      }

      const attemptEpoch = await resolveTicket(input, profile, providerName, input.attemptEpoch);
      const approvedSourceLabels = (input.approvedSourceLabels ?? [])
        .map((label) => labelId(label))
        .filter((label): label is string => label !== null);
      const completionId = randomUUID();
      const credential = await resolveSecret(profile.secretRef);
      const secretValues = credential === undefined ? [] : [credential];

      await assertEgress(profile, input, approvedSourceLabels);

      const record: CompletionRecord = {
        completionId,
        attemptEpoch: attemptEpoch ?? 0,
        profile,
        providerName,
        provider,
        model: profileModel(profile, options),
        purposeDigest,
        messages: [...(input.messages ?? [])],
        tools: [...(input.tools ?? [])],
        approvedSourceLabels,
        ...(credential === undefined ? {} : { credential }),
        secretValues,
        controller: new AbortController(),
        status: "created",
        streamClaimed: false,
        usage: null,
        providerRequestId: null,
      };
      completions.set(completionId, record);

      const streamEvents = (
        streamInput: StreamEventsInput | string,
      ): AsyncIterable<ModelGatewayEvent> => {
        const id = typeof streamInput === "string" ? streamInput : streamInput.completionId;
        const suppliedEpoch =
          typeof streamInput === "string" ? undefined : streamInput.attemptEpoch;
        const current = completions.get(id);

        if (current === undefined) {
          throw new Error(`Unknown completion: ${id}`);
        }
        if (suppliedEpoch !== undefined && suppliedEpoch !== current.attemptEpoch) {
          throw new Error(
            `Attempt epoch mismatch for completion ${id}: ` +
              `current ${current.attemptEpoch}, received ${suppliedEpoch}`,
          );
        }
        if (current.streamClaimed) {
          throw new Error(`Completion ${id} event stream was already consumed`);
        }
        current.streamClaimed = true;

        return streamRecord(current);
      };

      const events: AsyncIterable<ModelGatewayEvent> = {
        [Symbol.asyncIterator]: () =>
          streamEvents({ completionId, attemptEpoch: record.attemptEpoch })[Symbol.asyncIterator](),
      };

      return {
        completionId,
        attemptEpoch: record.attemptEpoch,
        provider: providerName,
        model: record.model,
        events,
        [Symbol.asyncIterator]() {
          return streamEvents({
            completionId,
            attemptEpoch: record.attemptEpoch,
          })[Symbol.asyncIterator]();
        },
      };
    },

    streamEvents(input: StreamEventsInput | string): AsyncIterable<ModelGatewayEvent> {
      const completionId = typeof input === "string" ? input : input.completionId;
      const attemptEpoch = typeof input === "string" ? undefined : input.attemptEpoch;
      const record = completions.get(completionId);

      if (record === undefined) {
        throw new Error(`Unknown completion: ${completionId}`);
      }
      if (attemptEpoch !== undefined && attemptEpoch !== record.attemptEpoch) {
        throw new Error(
          `Attempt epoch mismatch for completion ${completionId}: ` +
            `current ${record.attemptEpoch}, received ${attemptEpoch}`,
        );
      }
      if (record.streamClaimed) {
        throw new Error(`Completion ${completionId} event stream was already consumed`);
      }
      record.streamClaimed = true;

      return streamRecord(record);
    },

    cancelCompletion(input: CancelCompletionInput | string): CancelCompletionResult {
      const completionId = typeof input === "string" ? input : input.completionId;
      const record = completions.get(completionId);

      if (record === undefined) {
        throw new Error(`Unknown completion: ${completionId}`);
      }
      if (typeof input !== "string" && input.attemptEpoch !== record.attemptEpoch) {
        throw new Error(
          `Attempt epoch mismatch for completion ${completionId}: ` +
            `current ${record.attemptEpoch}, received ${input.attemptEpoch}`,
        );
      }

      if (record.status === "completed" || record.status === "cancelled") {
        return {
          completionId,
          cancelled: false,
          state: record.status,
          ...(record.cancelReason === undefined ? {} : { reason: record.cancelReason }),
        };
      }

      record.status = "cancelled";
      record.cancelReason = "requested";
      record.controller.abort("cancelled");

      return {
        completionId,
        cancelled: true,
        state: record.status,
        reason: "requested",
      };
    },

    getUsage(input?: StreamEventsInput | string): ModelUsage | readonly ModelUsage[] {
      if (input === undefined) {
        return [...completions.values()].map(
          (record) =>
            record.usage ??
            usageUnavailable(
              record.completionId,
              record.providerName,
              record.model,
              record.providerRequestId,
            ),
        );
      }

      const completionId = typeof input === "string" ? input : input.completionId;
      const record = completions.get(completionId);

      if (record === undefined) {
        throw new Error(`Unknown completion: ${completionId}`);
      }

      return (
        record.usage ??
        usageUnavailable(
          record.completionId,
          record.providerName,
          record.model,
          record.providerRequestId,
        )
      );
    },
  };

  const streamRecord = async function* streamRecord(
    record: CompletionRecord,
  ): AsyncGenerator<ModelGatewayEvent> {
    if (record.status === "cancelled") {
      yield {
        type: "cancelled",
        completionId: record.completionId,
        attemptEpoch: record.attemptEpoch,
        reason: record.cancelReason ?? "requested",
      };
      return;
    }

    const method = record.provider.stream ?? record.provider.createCompletion;
    if (method === undefined) {
      throw new Error(`Model provider ${record.providerName} cannot create completions`);
    }

    const providerRequest: ProviderCompletionRequest = {
      completionId: record.completionId,
      attemptEpoch: record.attemptEpoch,
      profileId: record.profile.id ?? "profile",
      model: record.model,
      purposeDigest: record.purposeDigest,
      approvedSourceLabels: record.approvedSourceLabels,
      messages: record.messages,
      tools: record.tools,
      signal: record.controller.signal,
      ...(record.credential === undefined ? {} : { credential: record.credential }),
      ...(record.profile.reasoningOptions === undefined
        ? {}
        : { reasoningOptions: record.profile.reasoningOptions }),
    };

    let iterator: AsyncIterator<ProviderStreamEvent>;
    try {
      const source = await method.call(record.provider, providerRequest);
      iterator = await asAsyncIterator<ProviderStreamEvent>(source);
    } catch (error) {
      record.status = "failed";
      const message = sanitizeError(error, record.secretValues);
      delete record.credential;
      record.secretValues = [];
      yield {
        type: "error",
        completionId: record.completionId,
        attemptEpoch: record.attemptEpoch,
        code: "provider_unavailable",
        message,
        retryable: false,
      };
      return;
    }

    record.status = "streaming";
    let terminal = false;

    try {
      while (!terminal) {
        const step = await nextOrAbort(iterator, record.controller.signal);

        if (step.kind === "aborted") {
          closeIterator(iterator);
          record.status = "cancelled";
          record.cancelReason = record.cancelReason ?? "requested";
          yield {
            type: "cancelled",
            completionId: record.completionId,
            attemptEpoch: record.attemptEpoch,
            reason: record.cancelReason,
          };
          return;
        }

        if (step.result.done === true) {
          break;
        }

        const event = step.result.value;
        const type = eventType(event);

        if (type === "token") {
          const delta =
            typeof event.delta === "string"
              ? event.delta
              : typeof event.text === "string"
                ? event.text
                : "";
          if (delta.length > 0) {
            yield {
              type: "token",
              completionId: record.completionId,
              attemptEpoch: record.attemptEpoch,
              delta,
            };
          }
          continue;
        }

        if (type === "tool_call") {
          const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : randomUUID();
          const toolName = typeof event.toolName === "string" ? event.toolName : "unknown_tool";
          const args = event.arguments ?? {};
          yield {
            type: "tool_call",
            completionId: record.completionId,
            attemptEpoch: record.attemptEpoch,
            toolCallId,
            toolName,
            arguments: args,
            argumentsDigest:
              typeof event.argumentsDigest === "string" ? event.argumentsDigest : digestOf(args),
          };
          continue;
        }

        if (type === "error") {
          record.status = "failed";
          yield {
            type: "error",
            completionId: record.completionId,
            attemptEpoch: record.attemptEpoch,
            code: typeof event.code === "string" ? event.code : "provider_error",
            message: sanitizeError(
              typeof event.message === "string" ? event.message : "Provider error",
              record.secretValues,
            ),
            retryable: event.retryable === true,
          };
          continue;
        }

        if (type === "cancelled") {
          record.status = "cancelled";
          record.cancelReason = typeof event.reason === "string" ? event.reason : "provider";
          terminal = true;
          yield {
            type: "cancelled",
            completionId: record.completionId,
            attemptEpoch: record.attemptEpoch,
            reason: record.cancelReason,
          };
          continue;
        }

        if (type === "completed") {
          const providerRequestId =
            typeof event.providerRequestId === "string"
              ? event.providerRequestId
              : record.providerRequestId;
          record.providerRequestId = providerRequestId;
          record.usage = normalizeUsage(
            event.usage,
            record.completionId,
            record.providerName,
            record.model,
            providerRequestId,
          );

          if (record.status !== "failed") {
            record.status = "completed";
          }
          terminal = true;
          yield {
            type: "completed",
            completionId: record.completionId,
            attemptEpoch: record.attemptEpoch,
            finishReason:
              typeof event.finishReason === "string"
                ? event.finishReason
                : typeof event.reason === "string"
                  ? event.reason
                  : "stop",
            usage: record.usage,
          };
        }
      }

      if (!terminal && record.status !== "cancelled") {
        if (record.status !== "failed") {
          record.status = "failed";
          yield {
            type: "error",
            completionId: record.completionId,
            attemptEpoch: record.attemptEpoch,
            code: "incomplete_stream",
            message: "Model provider stream ended without a completion event",
            retryable: false,
          };
        }
      }
    } catch (error) {
      record.status = "failed";
      yield {
        type: "error",
        completionId: record.completionId,
        attemptEpoch: record.attemptEpoch,
        code: "provider_stream_error",
        message: sanitizeError(error, record.secretValues),
        retryable: false,
      };
    } finally {
      delete record.credential;
      record.secretValues = [];
      closeIterator(iterator);
    }
  };

  return gateway;
}
