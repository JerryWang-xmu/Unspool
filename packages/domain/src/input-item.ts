import { object, text, textArray, timestamp } from "./validation.js";

export const INPUT_ITEM_KINDS = ["discussion", "suggestion", "agent_instruction"] as const;
export type InputItemKind = (typeof INPUT_ITEM_KINDS)[number];

export interface InputItem {
  id: string;
  workspaceId: string;
  kind: InputItemKind;
  body: string;
  authorId: string;
  createdAt: string;
  references: string[];
}

export function parseInputItem(value: unknown): InputItem {
  const input = object(value, "InputItem");
  const kind = text(input.kind, "InputItem.kind") as InputItemKind;
  if (!INPUT_ITEM_KINDS.includes(kind)) throw new TypeError(`Unsupported InputItem.kind: ${kind}`);
  return {
    id: text(input.id, "InputItem.id"),
    workspaceId: text(input.workspaceId, "InputItem.workspaceId"),
    kind,
    body: text(input.body, "InputItem.body"),
    authorId: text(input.authorId, "InputItem.authorId"),
    createdAt: timestamp(input.createdAt, "InputItem.createdAt"),
    references: textArray(input.references, "InputItem.references"),
  };
}

export function inputItemEntersAgentSession(item: Pick<InputItem, "kind">): boolean {
  return item.kind === "agent_instruction";
}
