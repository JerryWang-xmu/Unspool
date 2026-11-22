import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AgentModelConfig } from "../../../../packages/pi-adapter/src/openai-runtime.js";
import type {
  AgentEventHandler,
  AgentExecutionCommand,
  AgentExecutionStart,
  AgentExecutor,
  AgentWorkerEvent,
} from "./executor.js";

export interface IpcAgentExecutorOptions {
  readonly config: AgentModelConfig;
  readonly agentDir: string;
  readonly onEvent: AgentEventHandler;
  readonly workerEntry?: string | undefined;
  readonly timeoutMs?: number;
}

interface Pending {
  readonly resolve: () => void;
  readonly reject: (cause: Error) => void;
  readonly timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createIpcAgentExecutor(options: IpcAgentExecutorOptions): AgentExecutor {
  const workerEntry =
    options.workerEntry ??
    fileURLToPath(new URL("../../../execution-worker/src/agent-process.js", import.meta.url));
  const child: ChildProcess = fork(workerEntry, [], {
    env: {
      ...process.env,
      UNSPOOL_AGENT_MODEL_CONFIG: JSON.stringify(options.config),
      UNSPOOL_AGENT_DIR: options.agentDir,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const pending = new Map<string, Pending>();
  const timeoutMs = options.timeoutMs ?? 60_000;
  let closing = false;
  let eventChain: Promise<void> = Promise.resolve();

  function rejectPending(cause: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(cause);
    }
    pending.clear();
  }

  child.on("message", (message: unknown) => {
    if (!isRecord(message)) return;
    if (message.type === "event" && isRecord(message.event)) {
      eventChain = eventChain.then(() => options.onEvent(message.event as AgentWorkerEvent));
      return;
    }
    if (message.type !== "result" || typeof message.id !== "string") return;
    const request = pending.get(message.id);
    if (request === undefined) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok === true) request.resolve();
    else
      request.reject(
        new Error(
          typeof message.error === "string" ? message.error : "Agent worker command failed",
        ),
      );
  });
  child.on("error", (cause) => rejectPending(cause));
  child.on("exit", (code, signal) => {
    const reason = `Agent worker exited (code=${String(code)}, signal=${String(signal)})`;
    rejectPending(new Error(reason));
    if (!closing) {
      eventChain = eventChain.then(() =>
        options.onEvent({ kind: "worker.exited", runId: "", reason }),
      );
    }
  });

  function send(type: string, payload: unknown): Promise<void> {
    if ((closing && type !== "close") || child.killed || child.exitCode !== null) {
      return Promise.reject(new Error("Agent worker is not running"));
    }
    const id = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Agent worker command timed out: ${type}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.send({ type, id, payload }, (error) => {
        if (error === null) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    });
  }

  return {
    start: (input: AgentExecutionStart) => send("start", input),
    steer: (input: AgentExecutionCommand) => send("steer", input),
    followUp: (input: AgentExecutionCommand) => send("followUp", input),
    stop: (input: AgentExecutionCommand) => send("stop", input),

    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      if (child.exitCode === null && !child.killed) {
        try {
          await send("close", {});
        } catch {
          child.kill();
        }
      }
      rejectPending(new Error("Agent executor closed"));
      await eventChain;
    },
  };
}
