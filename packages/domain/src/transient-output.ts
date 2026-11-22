import { integer, object, text, timestamp } from "./validation.js";

export interface TransientOutput {
  runId: string;
  offset: number;
  delta: string;
  createdAt: string;
}

export function parseTransientOutput(value: unknown): TransientOutput {
  const input = object(value, "TransientOutput");
  return {
    runId: text(input.runId, "TransientOutput.runId"),
    offset: integer(input.offset, "TransientOutput.offset"),
    delta: text(input.delta, "TransientOutput.delta"),
    createdAt: timestamp(input.createdAt, "TransientOutput.createdAt"),
  };
}
