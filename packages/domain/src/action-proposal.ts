import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ActionResourceVersion {
  readonly id: string;
  readonly version: string;
}

/**
 * Canonical action bound by the approval digest. The envelope is evaluated at
 * the controlled execution boundary; approval surfaces only receive
 * `ActionProposalView`, which deliberately omits `canonicalArgs`.
 */
export interface ActionEnvelope {
  readonly toolName: string;
  readonly canonicalArgs: JsonValue;
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly recipients?: readonly string[];
  readonly baseResourceVersions?: readonly ActionResourceVersion[];
}

export interface ActionProposal {
  id: string;
  runId: string;
  attemptId: string;
  toolCallId: string;
  toolName: string;
  canonicalArgs: JsonValue;
  displayArgs: JsonObject;
  secretRefs: readonly string[];
  actionDigest: string;
  purpose: string;
  impact: string;
  risk: string;
  baseResourceVersions: readonly ActionResourceVersion[];
  createdAt: string;
}

/** Secret-free representation that may cross the approval API boundary. */
export type ActionProposalView = Omit<ActionProposal, "canonicalArgs">;

export interface CreateActionProposalInput {
  id: string;
  runId: string;
  attemptId: string;
  toolCallId: string;
  action: ActionEnvelope;
  displayArgs: JsonObject;
  secretRefs: readonly string[];
  purpose: string;
  impact: string;
  risk: string;
  createdAt: string;
}

/**
 * RFC 8785 JSON canonicalization for the JSON data model. Objects are sorted
 * by UTF-16 code units and arrays retain their order.
 */
export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeValue(value, new Set<object>());
}

export function sha256Digest(canonicalJson: string): string {
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}

/**
 * Hashes the real normalized action, including working directory, environment,
 * target, recipients, and base resource versions. Display-only arguments and
 * secret references are intentionally excluded.
 */
export function computeActionDigest(action: ActionEnvelope): string {
  const canonical: JsonObject = {
    toolName: action.toolName,
    canonicalArgs: action.canonicalArgs,
    workingDirectory: action.workingDirectory ?? null,
    environment: action.environment ? { ...action.environment } : null,
    target: action.target ?? null,
    recipients: action.recipients ? [...action.recipients] : [],
    baseResourceVersions: action.baseResourceVersions
      ? action.baseResourceVersions.map(({ id, version }) => ({ id, version }))
      : [],
  };

  return sha256Digest(canonicalizeJson(canonical));
}

export function createActionProposal(input: CreateActionProposalInput): ActionProposal {
  return {
    id: input.id,
    runId: input.runId,
    attemptId: input.attemptId,
    toolCallId: input.toolCallId,
    toolName: input.action.toolName,
    canonicalArgs: input.action.canonicalArgs,
    displayArgs: input.displayArgs,
    secretRefs: input.secretRefs,
    actionDigest: computeActionDigest(input.action),
    purpose: input.purpose,
    impact: input.impact,
    risk: input.risk,
    baseResourceVersions: input.action.baseResourceVersions ?? [],
    createdAt: input.createdAt,
  };
}

/**
 * Explicit projection used by approval queries and notifications. Keeping this
 * allow-list in one place prevents `canonicalArgs` from being spread into an
 * approver-visible payload later.
 */
export function toActionProposalView(proposal: ActionProposal): ActionProposalView {
  return {
    id: proposal.id,
    runId: proposal.runId,
    attemptId: proposal.attemptId,
    toolCallId: proposal.toolCallId,
    toolName: proposal.toolName,
    displayArgs: proposal.displayArgs,
    secretRefs: proposal.secretRefs,
    actionDigest: proposal.actionDigest,
    purpose: proposal.purpose,
    impact: proposal.impact,
    risk: proposal.risk,
    baseResourceVersions: proposal.baseResourceVersions,
    createdAt: proposal.createdAt,
  };
}

function canonicalizeValue(value: JsonValue, seen: Set<object>): string {
  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot represent a non-finite number");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Canonical JSON cannot represent a cycle");
    seen.add(value);
    const serialized = `[${value.map((entry) => canonicalizeValue(entry, seen)).join(",")}]`;
    seen.delete(value);
    return serialized;
  }

  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Canonical JSON cannot represent a cycle");
    seen.add(value);

    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const serialized = `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeValue(entry, seen)}`)
      .join(",")}}`;

    seen.delete(value);
    return serialized;
  }

  throw new TypeError(`Canonical JSON cannot represent ${typeof value}`);
}
