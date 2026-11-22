import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const OPENCODE_GO_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
export const UNSPOOL_USER_AGENT = "unspool/0.1.0";

export type AgentModelProvider = "faux" | "openai-compatible" | "opencode-go";
export type OpenAiApi = "openai-completions" | "openai-responses";

export interface AgentModelConfig {
  readonly provider: AgentModelProvider;
  readonly modelId: string;
  readonly baseUrl: string | null;
  readonly api: OpenAiApi;
  readonly apiKeyRef: string | null;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface ConversationModel {
  readonly id: string;
  readonly provider: string;
  readonly api: string;
  readonly baseUrl?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    throw new Error(`${name} is required for a real model provider`);
  }
  return trimmed;
}

function providerFrom(value: string | undefined): AgentModelProvider {
  const provider = value ?? "faux";
  if (provider === "faux" || provider === "openai-compatible" || provider === "opencode-go") {
    return provider;
  }
  throw new Error(`UNSPOOL_MODEL_PROVIDER is unsupported: ${provider}`);
}

function apiFrom(value: string | undefined): OpenAiApi {
  const api = value ?? "openai-completions";
  if (api === "openai-completions" || api === "openai-responses") return api;
  throw new Error(`UNSPOOL_MODEL_API is unsupported: ${api}`);
}

function baseUrlFrom(provider: AgentModelProvider, value: string | undefined): string | null {
  if (provider === "faux") return null;
  const raw =
    provider === "opencode-go"
      ? value?.trim() || OPENCODE_GO_BASE_URL
      : required(value, "UNSPOOL_MODEL_BASE_URL");
  const normalized = raw.replace(/\/+$/, "");
  const url = new URL(normalized);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !url.pathname.endsWith("/v1")
  ) {
    throw new Error(
      "UNSPOOL_MODEL_BASE_URL must be an HTTP(S) OpenAI-compatible URL ending in /v1 without credentials, query, or fragment",
    );
  }
  return normalized;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveAgentModelConfig(
  source: Readonly<Record<string, string | undefined>>,
): AgentModelConfig {
  const provider = providerFrom(source.UNSPOOL_MODEL_PROVIDER);
  const baseUrl = baseUrlFrom(provider, source.UNSPOOL_MODEL_BASE_URL);
  const modelId =
    provider === "faux" ? "faux-model" : required(source.UNSPOOL_MODEL_ID, "UNSPOOL_MODEL_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(modelId)) {
    throw new Error("UNSPOOL_MODEL_ID contains unsupported characters");
  }
  const apiKeyRef =
    provider === "faux"
      ? null
      : required(source.UNSPOOL_MODEL_API_KEY_REF, "UNSPOOL_MODEL_API_KEY_REF");
  if (apiKeyRef !== null && !apiKeyRef.startsWith("file:")) {
    throw new Error("UNSPOOL_MODEL_API_KEY_REF currently supports only file: references");
  }
  return {
    provider,
    modelId,
    baseUrl,
    api: apiFrom(source.UNSPOOL_MODEL_API),
    apiKeyRef,
    contextWindow: positiveInteger(
      source.UNSPOOL_MODEL_CONTEXT_WINDOW,
      128_000,
      "UNSPOOL_MODEL_CONTEXT_WINDOW",
    ),
    maxTokens: positiveInteger(source.UNSPOOL_MODEL_MAX_TOKENS, 16_384, "UNSPOOL_MODEL_MAX_TOKENS"),
  };
}

export async function readModelApiKey(config: AgentModelConfig): Promise<string | null> {
  if (config.apiKeyRef === null) return null;
  const path = config.apiKeyRef.slice("file:".length);
  if (path.trim().length === 0) throw new Error("Model API key file reference is empty");
  const key = (await readFile(path, "utf8")).trim();
  if (key.length === 0) throw new Error("Model API key file is empty");
  return key;
}

export async function writePiModelConfiguration(
  config: AgentModelConfig,
  agentDir: string,
): Promise<void> {
  if (config.provider === "faux" || config.baseUrl === null) {
    throw new Error("A real provider is required to write Pi model configuration");
  }
  await mkdir(agentDir, { recursive: true });
  const providerId = config.provider;
  const model = {
    id: config.modelId,
    name: `${providerId}/${config.modelId}`,
    api: config.api,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
  };
  const document = {
    $schema: "https://pi.dev/schemas/models.schema.json",
    providers: {
      [providerId]: {
        name: providerId,
        baseUrl: config.baseUrl,
        api: config.api,
        apiKey: "$UNSPOOL_MODEL_API_KEY",
        authHeader: true,
        models: [model],
      },
    },
  };
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function modelForConversation<T extends ConversationModel>(
  model: T,
  conversationId: string,
): T {
  const headers: Record<string, string> = {
    ...model.headers,
    "User-Agent": UNSPOOL_USER_AGENT,
  };
  if (model.provider === "opencode-go") {
    headers["x-opencode-session"] = conversationId;
  }
  return { ...model, headers };
}
