import { integer, object, optionalText, text, timestamp } from "./validation.js";

export interface AgentConversation {
  id: string;
  workspaceId: string;
  piSessionRef: string;
  sessionFormatVersion: number;
  continuationOfId?: string | undefined;
  createdAt: string;
}

/**
 * `piSessionRef` is the exact persistent pi session reference. Resumption must
 * open it directly; there is no "most recent conversation" fallback.
 */
export function parseAgentConversation(value: unknown): AgentConversation {
  const input = object(value, "AgentConversation");
  const id = text(input.id, "AgentConversation.id");
  const continuationOfId = optionalText(
    input.continuationOfId,
    "AgentConversation.continuationOfId",
  );
  if (continuationOfId === id) {
    throw new TypeError("AgentConversation cannot continue itself");
  }
  return {
    id,
    workspaceId: text(input.workspaceId, "AgentConversation.workspaceId"),
    piSessionRef: text(input.piSessionRef, "AgentConversation.piSessionRef"),
    sessionFormatVersion: integer(
      input.sessionFormatVersion,
      "AgentConversation.sessionFormatVersion",
      1,
    ),
    continuationOfId,
    createdAt: timestamp(input.createdAt, "AgentConversation.createdAt"),
  };
}
