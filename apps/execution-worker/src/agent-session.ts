import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  type AgentModelConfig,
  modelForConversation,
  readModelApiKey,
  writePiModelConfiguration,
} from "../../../packages/pi-adapter/src/openai-runtime.js";
import {
  createPiSessionAdapter,
  type PiSessionAdapter,
  type PiSessionManagerPort,
} from "../../../packages/pi-adapter/src/session-adapter.js";
import {
  openWorkspaceSession,
  type PiWorkspaceSdkPort,
} from "../../../packages/pi-adapter/src/session-registry.js";

export interface AgentStart {
  readonly runId: string;
  readonly attemptId: string;
  readonly attemptEpoch: number;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly cwd: string;
  readonly goal: string;
  readonly completionCriteria?: string | undefined;
  readonly instruction?: string | undefined;
}

export interface AgentRunCommand {
  readonly runId: string;
  readonly body: string;
}

export interface AgentWorkerEvent {
  readonly kind: string;
  readonly runId: string;
  readonly attemptId?: string;
  readonly attemptEpoch?: number;
  readonly workspaceId?: string;
  readonly [key: string]: unknown;
}

export interface AgentSessionWorkerOptions {
  readonly config: AgentModelConfig;
  readonly agentDir: string;
  readonly emit: (event: AgentWorkerEvent) => void | Promise<void>;
}

interface LiveRun {
  readonly start: AgentStart;
  readonly adapter: PiSessionAdapter;
  readonly manager: PiSessionManagerPort;
  completion: Promise<void>;
  stopping: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assistantText(value: unknown): string {
  if (!isRecord(value) || value.role !== "assistant") return "";
  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function errorDetail(value: unknown): string {
  if (!isRecord(value)) return "";
  const stopReason = value.stopReason;
  if (stopReason !== "error" && stopReason !== "aborted") return "";
  return typeof value.errorMessage === "string"
    ? value.errorMessage
    : `Model turn ${String(stopReason)}`;
}

function promptFor(start: AgentStart): string {
  const completion =
    start.completionCriteria === undefined
      ? ""
      : `\n\nCompletion criteria:\n${start.completionCriteria}`;
  const instruction = start.instruction?.trim();
  return `Task goal:\n${start.goal}${completion}${instruction === undefined || instruction.length === 0 ? "" : `\n\nOpening instruction:\n${instruction}`}`;
}

export function createAgentSessionWorker(options: AgentSessionWorkerOptions) {
  const live = new Map<string, LiveRun>();
  let eventChain: Promise<void> = Promise.resolve();
  let runtimePromise: Promise<ModelRuntime> | undefined;
  let apiKey: string | null = null;

  function emit(event: AgentWorkerEvent): Promise<void> {
    eventChain = eventChain.then(() => options.emit(event));
    return eventChain;
  }

  function safeMessage(cause: unknown): string {
    const message = cause instanceof Error ? cause.message : String(cause);
    return apiKey === null || apiKey.length === 0
      ? message
      : message.replaceAll(apiKey, "[redacted]");
  }

  function runtime(): Promise<ModelRuntime> {
    runtimePromise ??= (async () => {
      await writePiModelConfiguration(options.config, options.agentDir);
      const created = await ModelRuntime.create({
        authPath: join(options.agentDir, "auth.json"),
        modelsPath: join(options.agentDir, "models.json"),
        allowModelNetwork: false,
      });
      apiKey = await readModelApiKey(options.config);
      if (apiKey !== null) await created.setRuntimeApiKey(options.config.provider, apiKey);
      return created;
    })();
    return runtimePromise;
  }

  async function openRun(start: AgentStart): Promise<LiveRun> {
    const modelRuntime = await runtime();
    const configured = modelRuntime.getModel(options.config.provider, options.config.modelId);
    if (configured === undefined) {
      throw new Error(
        `Configured model is unavailable: ${options.config.provider}/${options.config.modelId}`,
      );
    }
    const model = modelForConversation(configured, start.conversationId);
    const sessionDir = join(options.agentDir, "sessions", start.workspaceId);
    const sessionPath = join(sessionDir, `${start.conversationId}.jsonl`);
    await mkdir(sessionDir, { recursive: true });
    const opened = await openWorkspaceSession({
      workspaceId: start.workspaceId,
      cwd: start.cwd,
      sessionPath,
      sessionDir,
      approvalExtensionPath: join(options.agentDir, "approval-extension.js"),
      sdk: {
        SessionManager,
        // The concrete SDK manager satisfies the port at runtime; the function's
        // declaration requires the full class rather than the narrower mock port.
        createAgentSession:
          createAgentSession as unknown as PiWorkspaceSdkPort["createAgentSession"],
      },
      agentDir: options.agentDir,
      modelRuntime,
      model,
      noTools: "all",
    });
    const queuePath = join(sessionDir, `${start.conversationId}.queue.json`);
    let modelError: string | null = null;
    const adapter = createPiSessionAdapter({
      session: opened.session,
      sessionManager: opened.sessionManager,
      queueStore: {
        persist: async (snapshot) => {
          await writeFile(queuePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
        },
      },
      writeChannel: { drain: () => modelRuntime.settleCredentialWrites() },
      onEvent: (event) => {
        if (!isRecord(event)) return;
        if (event.type === "message_end" && isRecord(event.message)) {
          const text = assistantText(event.message);
          if (text.length > 0) {
            void emit({
              kind: "message.completed",
              runId: start.runId,
              attemptId: start.attemptId,
              attemptEpoch: start.attemptEpoch,
              workspaceId: start.workspaceId,
              text,
            });
          }
          const reportedError = errorDetail(event.message);
          if (reportedError.length > 0) modelError = reportedError;
        }
        if (event.type === "tool_execution_start") {
          void emit({
            kind: "tool.preflight",
            runId: start.runId,
            attemptId: start.attemptId,
            attemptEpoch: start.attemptEpoch,
            workspaceId: start.workspaceId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            displayArgs: event.args,
          });
        }
        if (event.type === "tool_execution_end") {
          void emit({
            kind: "tool.finalized",
            runId: start.runId,
            attemptId: start.attemptId,
            attemptEpoch: start.attemptEpoch,
            workspaceId: start.workspaceId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            state: event.isError === true ? "failed" : "succeeded",
            result: event.result,
          });
        }
      },
    });
    const run: LiveRun = {
      start,
      adapter,
      manager: opened.sessionManager,
      stopping: false,
      completion: Promise.resolve(),
    };
    live.set(start.runId, run);
    run.completion = (async () => {
      try {
        await adapter.start(promptFor(start));
        if (run.stopping) return;
        if (modelError !== null) throw new Error(modelError);
        const checkpoint = await adapter.checkpoint({
          piLeafId: "",
          lastPersistedEntryId: "",
          lastProjectedEventId: "",
          artifactIds: [],
        });
        await emit({
          kind: "checkpoint",
          runId: start.runId,
          attemptId: start.attemptId,
          attemptEpoch: start.attemptEpoch,
          workspaceId: start.workspaceId,
          checkpoint: checkpoint.checkpoint,
        });
        await emit({
          kind: "run.completed",
          runId: start.runId,
          attemptId: start.attemptId,
          attemptEpoch: start.attemptEpoch,
          workspaceId: start.workspaceId,
        });
      } catch (cause) {
        if (!run.stopping) {
          await emit({
            kind: "run.failed",
            runId: start.runId,
            attemptId: start.attemptId,
            attemptEpoch: start.attemptEpoch,
            workspaceId: start.workspaceId,
            error: safeMessage(cause),
          });
        }
      } finally {
        await eventChain;
        if (live.get(start.runId) === run) live.delete(start.runId);
      }
    })();
    return run;
  }

  return {
    async start(start: AgentStart): Promise<void> {
      if (live.has(start.runId))
        throw new Error(`Run already has a live Pi session: ${start.runId}`);
      await openRun(start);
      await eventChain;
    },

    async steer(command: AgentRunCommand): Promise<void> {
      const run = live.get(command.runId);
      if (run === undefined) throw new Error("Run does not have a live Pi session");
      const disposition = await run.adapter.steer(command.body);
      await emit({
        kind: "command.disposition",
        runId: command.runId,
        command: "steer",
        disposition,
      });
    },

    async followUp(command: AgentRunCommand): Promise<void> {
      const run = live.get(command.runId);
      if (run === undefined) throw new Error("Run does not have a live Pi session");
      const disposition = await run.adapter.followUp(command.body);
      await emit({
        kind: "command.disposition",
        runId: command.runId,
        command: "follow_up",
        disposition,
      });
    },

    async stop(command: AgentRunCommand): Promise<void> {
      const run = live.get(command.runId);
      if (run === undefined) return;
      run.stopping = true;
      await run.adapter.stop();
      await emit({ kind: "run.stopped", runId: command.runId, stopped: true });
      live.delete(command.runId);
      await eventChain;
    },

    async close(): Promise<void> {
      const runs = [...live.values()];
      for (const run of runs) {
        run.stopping = true;
        await run.adapter.stop();
      }
      live.clear();
      await eventChain;
    },

    async waitForIdle(runId: string): Promise<void> {
      await live.get(runId)?.completion;
      await eventChain;
    },

    getActiveRunIds(): readonly string[] {
      return [...live.keys()];
    },
  };
}

export type AgentSessionWorker = ReturnType<typeof createAgentSessionWorker>;
