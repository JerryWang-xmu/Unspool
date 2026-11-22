import { createHash, randomUUID } from "node:crypto";

export interface FauxMessage {
  readonly role?: string;
  readonly content?: unknown;
  readonly [key: string]: unknown;
}

export interface FauxToolCall {
  readonly toolCallId?: string;
  readonly callId?: string;
  readonly toolName?: string;
  readonly name?: string;
  readonly arguments?: unknown;
  readonly args?: unknown;
}

export interface FauxUsage {
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly costAmount?: number | null;
  readonly costCurrency?: string | null;
  readonly reliability?: "reliable" | "estimated" | "unavailable";
}

export interface FauxErrorSpec {
  readonly code?: string;
  readonly message?: string;
  readonly retryable?: boolean;
}

export interface FauxScriptedResponse {
  readonly text?: string;
  readonly toolCalls?: readonly FauxToolCall[];
  readonly error?: FauxErrorSpec | string;
  readonly usage?: FauxUsage | "reliable" | "estimated" | "unavailable";
  readonly finishReason?: string;
}

export type FauxResponse = string | FauxScriptedResponse;

export interface FauxProviderOptions {
  readonly responses?: readonly FauxResponse[];
  readonly response?: FauxResponse;
  readonly defaultText?: string;
  readonly chunkSize?: number;
  readonly usage?: FauxUsage | "reliable" | "estimated" | "unavailable";
  readonly usageReliability?: "reliable" | "estimated" | "unavailable";
}

export interface FauxCompletionRequest {
  readonly completionId?: string;
  readonly model?: string;
  readonly messages: readonly FauxMessage[];
  readonly tools?: readonly unknown[];
  readonly signal?: AbortSignal;
  readonly [key: string]: unknown;
}

export type FauxProviderEvent =
  | {
      readonly type: "token";
      readonly delta: string;
    }
  | {
      readonly type: "tool_call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments: unknown;
      readonly argumentsDigest: string;
    }
  | {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly type: "completed";
      readonly finishReason: string;
      readonly usage: FauxUsage;
      readonly providerRequestId: string;
    };

export interface FauxProvider {
  readonly name: "faux";
  createCompletion(request: FauxCompletionRequest): AsyncIterable<FauxProviderEvent>;
  stream(request: FauxCompletionRequest): AsyncIterable<FauxProviderEvent>;
}

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part === "object" && part !== null && "text" in part) {
          const text = (part as { readonly text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const text = (content as { readonly text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
};

const lastMessageText = (messages: readonly FauxMessage[], role: string): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) {
      const text = textFromContent(message.content);
      if (text.length > 0) {
        return text;
      }
    }
  }
  return null;
};

const usageReliability = (
  value: FauxUsage | "reliable" | "estimated" | "unavailable" | undefined,
  fallback: "reliable" | "estimated" | "unavailable",
): "reliable" | "estimated" | "unavailable" => {
  if (value === "reliable" || value === "estimated" || value === "unavailable") {
    return value;
  }
  return value?.reliability ?? fallback;
};

const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

const normalizedUsage = (
  usage: FauxUsage | "reliable" | "estimated" | "unavailable" | undefined,
  fallbackReliability: "reliable" | "estimated" | "unavailable",
  inputText: string,
  outputText: string,
): FauxUsage => {
  const reliability = usageReliability(usage, fallbackReliability);
  if (reliability === "unavailable") {
    return {
      inputTokens: null,
      outputTokens: null,
      costAmount: null,
      costCurrency: null,
      reliability,
    };
  }

  const configured = typeof usage === "object" ? usage : undefined;
  const inputTokens = configured?.inputTokens ?? estimateTokens(inputText);
  const outputTokens = configured?.outputTokens ?? estimateTokens(outputText);
  const costAmount = configured?.costAmount ?? 0;
  const costCurrency = configured?.costCurrency ?? "USD";

  return {
    inputTokens,
    outputTokens,
    costAmount,
    costCurrency,
    reliability,
  };
};

const responseFrom = (
  scripted: FauxResponse[],
  options: FauxProviderOptions,
  request: FauxCompletionRequest,
): FauxResponse => {
  let response = scripted.shift() ?? options.response;

  if (response === undefined) {
    const prompt = lastMessageText(request.messages, "user");
    response = { text: options.defaultText ?? prompt ?? "faux completion" };
  }

  return response;
};

const asScripted = (response: FauxResponse): FauxScriptedResponse =>
  typeof response === "string" ? { text: response } : response;

const digestOf = (value: unknown): string => {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value === undefined ? null : value);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
};

const waitForTurn = async (signal: AbortSignal | undefined): Promise<boolean> => {
  const aborted = (): boolean => signal?.aborted === true;
  if (aborted()) {
    return false;
  }
  await Promise.resolve();
  return !aborted();
};

const chunkText = (text: string, chunkSize: number): string[] => {
  if (text.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    chunks.push(text.slice(offset, offset + chunkSize));
  }
  return chunks;
};

export function createFauxProvider(options: FauxProviderOptions = {}): FauxProvider {
  const scripted: FauxResponse[] = [...(options.responses ?? [])];
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? 16));
  let requestCounter = 0;

  const createCompletion = (request: FauxCompletionRequest): AsyncIterable<FauxProviderEvent> => {
    const response = asScripted(responseFrom(scripted, options, request));
    requestCounter += 1;
    const providerRequestId = `faux-${request.completionId ?? requestCounter}`;
    const inputText = request.messages
      .map((message) => textFromContent(message.content))
      .join("\n");
    const outputText = response.text ?? "";
    const usage = normalizedUsage(
      response.usage ?? options.usage,
      usageReliability(options.usage, options.usageReliability ?? "reliable"),
      inputText,
      outputText,
    );

    return (async function* streamFauxCompletion(): AsyncGenerator<FauxProviderEvent> {
      if (!(await waitForTurn(request.signal))) {
        return;
      }

      if (response.error !== undefined) {
        const error =
          typeof response.error === "string"
            ? { code: "faux_error", message: response.error, retryable: false }
            : {
                code: response.error.code ?? "faux_error",
                message: response.error.message ?? "Faux provider error",
                retryable: response.error.retryable ?? false,
              };
        yield { type: "error", ...error };
        yield {
          type: "completed",
          finishReason: "error",
          usage: { ...usage, reliability: "unavailable" },
          providerRequestId,
        };
        return;
      }

      for (const chunk of chunkText(outputText, chunkSize)) {
        if (!(await waitForTurn(request.signal))) {
          return;
        }
        yield { type: "token", delta: chunk };
      }

      for (const toolCall of response.toolCalls ?? []) {
        if (!(await waitForTurn(request.signal))) {
          return;
        }
        const args = toolCall.arguments ?? toolCall.args ?? {};
        yield {
          type: "tool_call",
          toolCallId: toolCall.toolCallId ?? toolCall.callId ?? randomUUID(),
          toolName: toolCall.toolName ?? toolCall.name ?? "faux_tool",
          arguments: args,
          argumentsDigest: digestOf(args),
        };
      }

      const finishReason =
        response.finishReason ?? ((response.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop");

      yield {
        type: "completed",
        finishReason,
        usage,
        providerRequestId,
      };
    })();
  };

  return {
    name: "faux",
    createCompletion,
    stream: createCompletion,
  };
}
