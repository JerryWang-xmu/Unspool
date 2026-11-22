export interface OverviewEvent {
  readonly workspaceId: string;
  readonly sequence: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

export function projectOverview<T extends OverviewEvent>(
  events: readonly T[],
  options: { afterSequence?: number; limit?: number } = {},
) {
  const after = options.afterSequence ?? 0;
  const limit = options.limit ?? 50;
  const selected = [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => event.sequence > after)
    .slice(0, limit);
  return {
    events: selected,
    nextSequence: selected.at(-1)?.sequence ?? after,
    hasMore: events.some((event) => event.sequence > (selected.at(-1)?.sequence ?? after)),
  };
}

export function coalesceOutputs(
  chunks: readonly { type: string; text: string }[],
): { type: string; text: string }[] {
  const result: { type: string; text: string }[] = [];
  for (const chunk of chunks) {
    const previous = result.at(-1);
    if (previous !== undefined && previous.type === "output" && chunk.type === "output")
      previous.text += chunk.text;
    else result.push({ type: chunk.type, text: chunk.text });
  }
  return result;
}

export class SseBackpressure {
  readonly #maxBuffered: number;
  #buffered = 0;

  constructor(maxBuffered = 100) {
    this.#maxBuffered = maxBuffered;
  }

  offer(_event: unknown): "accepted" | "stale" {
    if (this.#buffered >= this.#maxBuffered) return "stale";
    this.#buffered += 1;
    return "accepted";
  }

  drain(): void {
    this.#buffered = 0;
  }
}
