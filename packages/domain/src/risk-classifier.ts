import type { ActionEnvelope, JsonValue } from "./action-proposal.js";

export type ActionRisk = "low" | "medium" | "high";
export type UnknownToolBehavior = "high" | "deny";

export interface ToolRiskRule {
  readonly risk: ActionRisk;
  readonly effect?: "read" | "write" | "external" | "shell";
}

export interface RiskPolicy {
  readonly tools: Readonly<Record<string, ToolRiskRule>>;
  readonly unknownTool: UnknownToolBehavior;
  readonly bash: UnknownToolBehavior;
}

export interface RiskClassification {
  readonly toolName: string;
  readonly risk: ActionRisk;
  readonly requiresApproval: boolean;
  readonly denied: boolean;
  readonly effect: ToolRiskRule["effect"] | "unknown";
  readonly reasons: readonly string[];
}

const BASH_NAMES = new Set(["bash", "shell", "sh", "cmd", "powershell", "terminal"]);
const WRITE_PATTERN =
  /(?:^|[_-])(write|edit|delete|remove|patch|move|rename|mkdir|upload)(?:$|[_-])/i;
const EXTERNAL_PATTERN =
  /(?:^|[_-])(http|fetch|request|email|send|message|deploy|publish|webhook)(?:$|[_-])/i;

export const DEFAULT_RISK_POLICY: RiskPolicy = Object.freeze({
  unknownTool: "high",
  bash: "high",
  tools: Object.freeze({
    read_file: { risk: "low", effect: "read" },
    list_files: { risk: "low", effect: "read" },
    search_files: { risk: "low", effect: "read" },
    write_file: { risk: "high", effect: "write" },
    edit_file: { risk: "high", effect: "write" },
    delete_file: { risk: "high", effect: "write" },
    apply_patch: { risk: "high", effect: "write" },
    http_request: { risk: "high", effect: "external" },
  } satisfies Record<string, ToolRiskRule>),
});

function normalizedName(value: string): string {
  const name = value.trim().toLowerCase();
  if (name.length === 0) throw new TypeError("toolName is required");
  return name;
}

function hasExternalTarget(action: ActionEnvelope): boolean {
  if (action.recipients !== undefined && action.recipients.length > 0) return true;
  return action.target !== undefined && /^(?:https?|ssh|ftp):\/\//i.test(action.target);
}

/** The model's read-only claim is deliberately not an input to this classifier. */
export function classifyActionRisk(
  action: ActionEnvelope,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): RiskClassification {
  const toolName = normalizedName(action.toolName);
  const rule = policy.tools[toolName];
  const isBash = BASH_NAMES.has(toolName) || rule?.effect === "shell";
  const isWrite = rule?.effect === "write" || WRITE_PATTERN.test(toolName);
  const isExternal =
    rule?.effect === "external" || EXTERNAL_PATTERN.test(toolName) || hasExternalTarget(action);
  const reasons: string[] = [];
  let denied = false;
  let risk: ActionRisk = rule?.risk ?? "high";
  let effect: RiskClassification["effect"] = rule?.effect ?? "unknown";

  if (rule === undefined) {
    reasons.push("unknown_tool_default");
    denied = policy.unknownTool === "deny";
  }
  if (isBash) {
    reasons.push("shell_commands_always_require_the_shell_policy");
    risk = "high";
    effect = "shell";
    denied ||= policy.bash === "deny";
  } else if (isWrite) {
    reasons.push("write_side_effect");
    risk = rule === undefined ? "high" : risk;
    effect = "write";
  } else if (isExternal) {
    reasons.push("external_side_effect");
    risk = rule === undefined ? "high" : risk;
    effect = "external";
  }

  if (hasExternalTarget(action) && !reasons.includes("external_side_effect")) {
    reasons.push("external_side_effect");
    risk = "high";
    effect = "external";
  }

  return Object.freeze({
    toolName: action.toolName,
    risk,
    requiresApproval: !denied && risk === "high",
    denied,
    effect,
    reasons: Object.freeze(reasons),
  });
}

export function actionArguments(action: ActionEnvelope): JsonValue {
  return action.canonicalArgs;
}
