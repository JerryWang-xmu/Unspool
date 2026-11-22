import type {
  AgentRunCommand,
  AgentStart,
  AgentWorkerEvent,
} from "../../../execution-worker/src/agent-session.js";

export interface AgentExecutionStart extends AgentStart {
  readonly actorId: string;
  readonly operatorEpoch: number;
}

export interface AgentExecutionCommand extends AgentRunCommand {
  readonly actorId: string;
  readonly operatorEpoch: number;
}

export interface AgentExecutor {
  start(input: AgentExecutionStart): Promise<void>;
  steer(input: AgentExecutionCommand): Promise<void>;
  followUp(input: AgentExecutionCommand): Promise<void>;
  stop(input: AgentExecutionCommand): Promise<void>;
  close(): Promise<void>;
}

export type AgentEventHandler = (event: AgentWorkerEvent) => void | Promise<void>;
export type { AgentWorkerEvent };
