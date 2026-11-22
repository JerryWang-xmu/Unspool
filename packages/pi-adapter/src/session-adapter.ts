/**
 * Thin execution adapter around one pi AgentSession.
 *
 * The adapter treats the pi session as an injected port so the worker can
 * substitute a fake model provider. It preserves the fixed startup order,
 * never expands prompt templates, and keeps pi's queue and Unspool's durable
 * queue snapshot distinct.
 */

export type PiQueuedInputDisposition = "handled" | "queued";

export interface PiSessionCheckpoint {
  piLeafId: string;
  lastPersistedEntryId: string;
  lastProjectedEventId: string;
  artifactIds: readonly string[];
  [key: string]: unknown;
}

export interface PiAgentSessionPort {
  readonly agent: { toolExecution: string };
  readonly isIdle?: boolean | undefined;
  subscribe(listener: (event: unknown) => void): () => void;
  bindExtensions(bindings: Record<string, unknown>): Promise<void>;
  prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
  steer(text: string): Promise<PiQueuedInputDisposition>;
  followUp(text: string): Promise<PiQueuedInputDisposition>;
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };
  abort(): Promise<void>;
}

export interface PiSessionManagerPort {
  getLeafId(): string | null;
  getEntries(): ReadonlyArray<{ id: string }>;
}

export interface PiQueueSnapshot {
  steering: string[];
  followUp: string[];
}

export interface PiQueueStore {
  persist(snapshot: PiQueueSnapshot): Promise<void>;
}

export interface PiWriteChannel {
  drain(): Promise<void>;
}

export interface PiSessionAdapterInput {
  session: PiAgentSessionPort;
  sessionManager: PiSessionManagerPort;
  queueStore: PiQueueStore;
  writeChannel: PiWriteChannel;
  onEvent?: ((event: unknown) => void) | undefined;
}

export interface PiWithheldInstruction {
  kind: "steer" | "follow_up";
  body: string;
  status: "withheld";
}

export interface PiStopResult {
  outcome: "stopped";
  queue: PiWithheldInstruction[];
}

export interface PiCheckpointResult<TCheckpoint extends PiSessionCheckpoint> {
  advanced: boolean;
  checkpoint: TCheckpoint;
}

export interface PiSessionAdapter {
  start(text: string): Promise<void>;
  steer(text: string): Promise<PiQueuedInputDisposition>;
  followUp(text: string): Promise<PiQueuedInputDisposition>;
  stop(): Promise<PiStopResult>;
  checkpoint<TCheckpoint extends PiSessionCheckpoint>(
    current: TCheckpoint,
  ): Promise<PiCheckpointResult<TCheckpoint>>;
}

export function createPiSessionAdapter(input: PiSessionAdapterInput): PiSessionAdapter {
  const { session, sessionManager, queueStore, writeChannel } = input;
  let initialization: Promise<void> | undefined;

  function ensureInitialized(): Promise<void> {
    initialization ??= (async () => {
      session.subscribe((event) => {
        input.onEvent?.(event);
      });
      await session.bindExtensions({});
    })();
    return initialization;
  }

  async function start(text: string): Promise<void> {
    if (session.isIdle === false) {
      throw new Error("Pi session is not idle; start requires an idle session");
    }

    await ensureInitialized();
    session.agent.toolExecution = "sequential";
    await session.prompt(text, { expandPromptTemplates: false });
  }

  async function steer(text: string): Promise<PiQueuedInputDisposition> {
    return session.steer(text);
  }

  async function followUp(text: string): Promise<PiQueuedInputDisposition> {
    return session.followUp(text);
  }

  async function stop(): Promise<PiStopResult> {
    const snapshot: PiQueueSnapshot = {
      steering: [...session.getSteeringMessages()],
      followUp: [...session.getFollowUpMessages()],
    };

    await queueStore.persist(snapshot);
    session.clearQueue();
    await session.abort();
    await writeChannel.drain();

    return {
      outcome: "stopped",
      queue: [
        ...snapshot.steering.map((body) => ({
          kind: "steer" as const,
          body,
          status: "withheld" as const,
        })),
        ...snapshot.followUp.map((body) => ({
          kind: "follow_up" as const,
          body,
          status: "withheld" as const,
        })),
      ],
    };
  }

  async function checkpoint<TCheckpoint extends PiSessionCheckpoint>(
    current: TCheckpoint,
  ): Promise<PiCheckpointResult<TCheckpoint>> {
    await writeChannel.drain();

    const leafId = sessionManager.getLeafId();
    const lastEntry = sessionManager.getEntries().at(-1);
    const piLeafId = leafId ?? current.piLeafId;
    const lastPersistedEntryId = lastEntry?.id ?? current.lastPersistedEntryId;

    return {
      advanced:
        piLeafId !== current.piLeafId || lastPersistedEntryId !== current.lastPersistedEntryId,
      checkpoint: {
        ...current,
        piLeafId,
        lastPersistedEntryId,
      },
    };
  }

  return { start, steer, followUp, stop, checkpoint };
}
