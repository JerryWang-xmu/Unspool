import {
  type ActionEnvelope,
  type ActionProposal,
  createActionProposal,
  type JsonObject,
  type JsonValue,
} from "../../domain/src/action-proposal.js";
import {
  classifyActionRisk,
  DEFAULT_RISK_POLICY,
  type RiskClassification,
  type RiskPolicy,
} from "../../domain/src/risk-classifier.js";
import { uuidv7 } from "../../security/src/uuid.js";

export interface PiActionProposalInput {
  readonly id?: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly toolCallId: string;
  readonly action: ActionEnvelope;
  readonly purpose?: string;
  readonly impact?: string;
  readonly policy?: RiskPolicy;
  /** JSON Pointers to redact, mapped to stable secret references (never secret values). */
  readonly redactions?: Readonly<Record<string, string>>;
  readonly createdAt?: string;
}

export interface PiActionProposalResult {
  readonly proposal: ActionProposal;
  readonly classification: RiskClassification;
}

export class ActionDeniedError extends Error {
  readonly code = "action_denied";

  constructor(toolName: string) {
    super(`Tool action is denied by policy: ${toolName}`);
    this.name = "ActionDeniedError";
  }
}

const SECRET_KEY =
  /(?:^|[_-])(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?key)(?:$|[_-])/i;
const SECRET_VALUE = /^(?:Bearer\s+\S+|(?:sk|rk|pk)_[A-Za-z0-9_-]{12,})$/i;

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function displayValue(
  value: JsonValue,
  path: string,
  key: string | undefined,
  redactions: Readonly<Record<string, string>>,
  secretRefs: Set<string>,
): JsonValue {
  const explicitReference = redactions[path];
  const inferredSecret =
    (key !== undefined && SECRET_KEY.test(key)) ||
    (typeof value === "string" && SECRET_VALUE.test(value));
  if (explicitReference !== undefined || inferredSecret) {
    const reference = explicitReference ?? `secret:${path || "/"}`;
    secretRefs.add(reference);
    return `<redacted:${reference}>`;
  }
  if (Array.isArray(value))
    return value.map((entry, index) =>
      displayValue(entry, `${path}/${index}`, undefined, redactions, secretRefs),
    );
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        displayValue(
          childValue,
          `${path}/${pointerToken(childKey)}`,
          childKey,
          redactions,
          secretRefs,
        ),
      ]),
    );
  }
  return value;
}

export function createPiActionProposal(input: PiActionProposalInput): PiActionProposalResult {
  const classification = classifyActionRisk(input.action, input.policy ?? DEFAULT_RISK_POLICY);
  if (classification.denied) throw new ActionDeniedError(input.action.toolName);
  const secretRefs = new Set<string>();
  const redactions = input.redactions ?? {};
  const canonical = input.action.canonicalArgs;
  const base: Record<string, JsonValue> =
    canonical !== null && typeof canonical === "object" && !Array.isArray(canonical)
      ? { ...(canonical as JsonObject) }
      : { value: canonical };
  const displayArguments = displayValue(base, "", undefined, redactions, secretRefs) as JsonObject;
  const displayArgs: JsonObject = {
    ...displayArguments,
    ...(input.action.workingDirectory === undefined
      ? {}
      : { $workingDirectory: input.action.workingDirectory }),
    ...(input.action.environment === undefined
      ? {}
      : {
          $environment: displayValue(
            { ...input.action.environment },
            "/environment",
            "environment",
            redactions,
            secretRefs,
          ),
        }),
    ...(input.action.target === undefined ? {} : { $target: input.action.target }),
    ...(input.action.recipients === undefined ? {} : { $recipients: [...input.action.recipients] }),
  };
  const createdAt = input.createdAt ?? new Date().toISOString();
  const proposal = createActionProposal({
    id: input.id ?? uuidv7(),
    runId: input.runId,
    attemptId: input.attemptId,
    toolCallId: input.toolCallId,
    action: input.action,
    displayArgs,
    secretRefs: [...secretRefs].sort(),
    purpose:
      input.purpose ?? `Review the complete semantic arguments for ${input.action.toolName}.`,
    impact:
      input.impact ??
      `The action has a ${classification.effect} effect and requires ${classification.risk}-risk handling.`,
    risk: classification.risk,
    createdAt,
  });
  return { proposal, classification };
}
