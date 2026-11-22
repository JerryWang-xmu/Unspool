import { fedInteger, fedObject, fedText, fedTime } from "./federation-validation.js";

export interface RevocationDirective {
  readonly id: string;
  readonly targetType: "node" | "grant" | "resource" | "operation";
  readonly targetId: string;
  readonly stateRevision: number;
  readonly effectiveAt: string;
  readonly reason: string;
  readonly scope: "local" | "team" | "workspace" | "node";
  readonly ownerOrSecuritySignature: string;
}

export function parseRevocationDirective(value: unknown): RevocationDirective {
  const input = fedObject(value, "RevocationDirective");
  const targetType = fedText(
    input.targetType,
    "RevocationDirective.targetType",
  ) as RevocationDirective["targetType"];
  if (!["node", "grant", "resource", "operation"].includes(targetType))
    throw new TypeError("Unsupported RevocationDirective.targetType");
  const scope = fedText(input.scope, "RevocationDirective.scope") as RevocationDirective["scope"];
  if (!["local", "team", "workspace", "node"].includes(scope))
    throw new TypeError("Unsupported RevocationDirective.scope");
  return Object.freeze({
    id: fedText(input.id, "RevocationDirective.id"),
    targetType,
    targetId: fedText(input.targetId, "RevocationDirective.targetId"),
    stateRevision: fedInteger(input.stateRevision, "RevocationDirective.stateRevision", 1),
    effectiveAt: fedTime(input.effectiveAt, "RevocationDirective.effectiveAt"),
    reason: fedText(input.reason, "RevocationDirective.reason"),
    scope,
    ownerOrSecuritySignature: fedText(
      input.ownerOrSecuritySignature,
      "RevocationDirective.ownerOrSecuritySignature",
    ),
  });
}

export function revocationDirectivePrecedes(
  left: RevocationDirective,
  right: RevocationDirective,
): boolean {
  if (left.stateRevision !== right.stateRevision) return left.stateRevision > right.stateRevision;
  return Date.parse(left.effectiveAt) >= Date.parse(right.effectiveAt);
}
