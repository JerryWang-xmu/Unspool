import { resolveAgentModelConfig } from "../../../packages/pi-adapter/src/openai-runtime.js";
import {
  type AgentRunCommand,
  type AgentStart,
  createAgentSessionWorker,
} from "./agent-session.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payload<T>(value: unknown): T {
  if (!isRecord(value)) throw new TypeError("Agent IPC payload must be an object");
  return value as T;
}

function send(message: unknown): void {
  process.send?.(message);
}

const rawConfig = JSON.parse(requiredEnv("UNSPOOL_AGENT_MODEL_CONFIG")) as Record<string, unknown>;
const config = resolveAgentModelConfig({
  UNSPOOL_MODEL_PROVIDER: typeof rawConfig.provider === "string" ? rawConfig.provider : undefined,
  UNSPOOL_MODEL_BASE_URL: typeof rawConfig.baseUrl === "string" ? rawConfig.baseUrl : undefined,
  UNSPOOL_MODEL_ID: typeof rawConfig.modelId === "string" ? rawConfig.modelId : undefined,
  UNSPOOL_MODEL_API: typeof rawConfig.api === "string" ? rawConfig.api : undefined,
  UNSPOOL_MODEL_API_KEY_REF:
    typeof rawConfig.apiKeyRef === "string" ? rawConfig.apiKeyRef : undefined,
  UNSPOOL_MODEL_CONTEXT_WINDOW: String(rawConfig.contextWindow),
  UNSPOOL_MODEL_MAX_TOKENS: String(rawConfig.maxTokens),
});
const worker = createAgentSessionWorker({
  config,
  agentDir: requiredEnv("UNSPOOL_AGENT_DIR"),
  emit: (event) => {
    send({ type: "event", event });
  },
});

process.on("message", (message: unknown) => {
  void (async () => {
    if (!isRecord(message) || typeof message.type !== "string" || typeof message.id !== "string")
      return;
    const { type, id } = message;
    try {
      switch (type) {
        case "start":
          await worker.start(payload<AgentStart>(message.payload));
          break;
        case "steer":
          await worker.steer(payload<AgentRunCommand>(message.payload));
          break;
        case "followUp":
          await worker.followUp(payload<AgentRunCommand>(message.payload));
          break;
        case "stop":
          await worker.stop(payload<AgentRunCommand>(message.payload));
          break;
        case "close":
          await worker.close();
          break;
        default:
          throw new Error(`Unknown Agent IPC command: ${type}`);
      }
      if (type === "close") {
        if (process.send) {
          process.send({ type: "result", id, ok: true }, () => process.exit(0));
        } else {
          process.exit(0);
        }
      } else {
        send({ type: "result", id, ok: true });
      }
    } catch (cause) {
      send({
        type: "result",
        id,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  })();
});

process.once("SIGTERM", () => {
  void worker.close().finally(() => process.exit(0));
});
process.once("SIGINT", () => {
  void worker.close().finally(() => process.exit(0));
});
