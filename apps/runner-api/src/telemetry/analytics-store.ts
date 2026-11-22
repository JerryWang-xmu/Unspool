import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const FORBIDDEN_KEYS = new Set([
  "body",
  "content",
  "text",
  "instruction",
  "discussion",
  "question",
  "answer",
  "args",
  "arguments",
  "canonicalargs",
  "path",
  "paths",
  "filepath",
  "filename",
  "parameters",
  "payload",
  "privateqa",
  "secret",
  "token",
  "password",
  "credential",
]);

export interface AnalyticsEvent {
  readonly eventName: string;
  readonly occurredAt: string;
  readonly actorPseudonym?: string | undefined;
  readonly workspacePseudonym?: string | undefined;
  readonly metadata: Record<string, unknown>;
}

function assertSafeEvent(event: AnalyticsEvent): void {
  if (
    !event.eventName ||
    !event.occurredAt ||
    !event.metadata ||
    typeof event.metadata !== "object" ||
    Array.isArray(event.metadata)
  ) {
    throw new TypeError("analytics event requires a name, timestamp, and metadata object");
  }
  for (const key of Object.keys(event.metadata)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase()))
      throw new TypeError(`analytics metadata cannot contain ${key}`);
    const value = event.metadata[key];
    if (["string", "number", "boolean"].includes(typeof value) || value === null) continue;
    throw new TypeError(`analytics metadata ${key} must be scalar`);
  }
}

export function createAnalyticsStore(filePath?: string) {
  const events: AnalyticsEvent[] = [];
  return {
    async record(event: AnalyticsEvent): Promise<void> {
      assertSafeEvent(event);
      events.push(event);
      if (filePath) {
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
      }
    },
    async query(eventName?: string): Promise<AnalyticsEvent[]> {
      if (!filePath) return events.filter((event) => !eventName || event.eventName === eventName);
      try {
        const text = await readFile(filePath, "utf8");
        return text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AnalyticsEvent)
          .filter((event) => !eventName || event.eventName === eventName);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async exportMetadata(): Promise<AnalyticsEvent[]> {
      return this.query();
    },
  };
}
