import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SharedContinuationInput {
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
  readonly selectedEntryIds: readonly string[];
  readonly entries: readonly Record<string, unknown>[];
}

export function createSharedContinuationSession(
  input: SharedContinuationInput,
): Record<string, unknown>[] {
  if (input.sourceConversationId === input.targetConversationId)
    throw new TypeError("A shared continuation needs a new conversation id");
  if (input.selectedEntryIds.length === 0)
    throw new TypeError("A shared continuation requires an explicit entry selection");
  const selected = new Set(input.selectedEntryIds);
  const entries = input.entries.filter(
    (entry) => typeof entry.id === "string" && selected.has(entry.id),
  );
  if (entries.length !== selected.size)
    throw new TypeError("Every selected session entry must exist in the source");
  return [
    {
      type: "session",
      version: 1,
      id: input.targetConversationId,
      continuationOfId: input.sourceConversationId,
    },
    ...entries,
  ];
}

export async function writeSharedContinuationSession(options: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
  readonly selectedEntryIds: readonly string[];
}): Promise<void> {
  const source = await readFile(options.sourcePath, "utf8");
  const entries = source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.type !== "session");
  const continuation = createSharedContinuationSession({ ...options, entries });
  await mkdir(dirname(options.targetPath), { recursive: true });
  await writeFile(
    options.targetPath,
    `${continuation.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}
