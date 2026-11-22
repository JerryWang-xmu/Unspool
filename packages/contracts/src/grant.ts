import type { B0Grant, B0GrantState } from "../../test-support/src/federation/fixtures.js";
import {
  fedDigest,
  federationDigest,
  fedInteger,
  fedObject,
  fedStrings,
  fedText,
  fedTime,
} from "./federation-validation.js";

export type {
  B0Grant as Grant,
  B0GrantRecipientRules as RecipientRules,
  B0GrantRights as GrantRights,
  B0GrantState as GrantState,
} from "../../test-support/src/federation/fixtures.js";

export const GRANT_TERMINAL_STATES = ["expired", "revoked", "rejected"] as const;

export function parseFederatedBetaEnabled(value: unknown): boolean {
  return value === true;
}

export function parseGrant(value: unknown): B0Grant {
  const input = fedObject(value, "Grant");
  const state = fedText(input.state, "Grant.state") as B0GrantState;
  if (!["active", "expired", "revoked", "rejected"].includes(state))
    throw new TypeError(`Unsupported Grant.state: ${state}`);
  return {
    id: fedText(input.id, "Grant.id"),
    nodeId: fedText(input.nodeId, "Grant.nodeId"),
    ownerId: fedText(input.ownerId, "Grant.ownerId"),
    teamId: fedText(input.teamId, "Grant.teamId"),
    workspaceId: fedText(input.workspaceId, "Grant.workspaceId"),
    runId: fedText(input.runId, "Grant.runId"),
    purposeDigest: fedDigest(input.purposeDigest, "Grant.purposeDigest"),
    resourceId: fedText(input.resourceId, "Grant.resourceId"),
    resourceDigest: fedDigest(input.resourceDigest, "Grant.resourceDigest"),
    operations: fedStrings(input.operations, "Grant.operations"),
    requesterIds: fedStrings(input.requesterIds, "Grant.requesterIds"),
    recipientRules: input.recipientRules as B0Grant["recipientRules"],
    rights: input.rights as B0Grant["rights"],
    notBefore: fedTime(input.notBefore, "Grant.notBefore"),
    expiresAt: fedTime(input.expiresAt, "Grant.expiresAt"),
    usageLimit: fedInteger(input.usageLimit, "Grant.usageLimit", 1),
    budget: input.budget as B0Grant["budget"],
    cachePolicy: input.cachePolicy as B0Grant["cachePolicy"],
    handoffPolicy: "no_transfer",
    policyRevision: fedInteger(input.policyRevision, "Grant.policyRevision", 1),
    ownerSignature: fedText(input.ownerSignature, "Grant.ownerSignature"),
    state,
  };
}

export function grantDigest(grant: B0Grant): string {
  const { uploadState: _uploadState, ...canonical } = grant as B0Grant & { uploadState?: string };
  return federationDigest(canonical);
}

export function reduceGrant(current: B0Grant, requested: Partial<B0Grant>): B0Grant {
  const grant = parseGrant(current);
  if (
    requested.operations !== undefined &&
    !requested.operations.every((operation) => grant.operations.includes(operation))
  )
    throw new TypeError("Grant operations cannot expand");
  if (
    requested.requesterIds !== undefined &&
    !requested.requesterIds.every((id) => grant.requesterIds.includes(id))
  )
    throw new TypeError("Grant requesters cannot expand");
  if (requested.usageLimit !== undefined && requested.usageLimit > grant.usageLimit)
    throw new TypeError("Grant usageLimit cannot expand");
  if (
    requested.expiresAt !== undefined &&
    Date.parse(requested.expiresAt) > Date.parse(grant.expiresAt)
  )
    throw new TypeError("Grant expiry cannot expand");
  if (requested.rights !== undefined) {
    for (const field of ["modelDisclose", "memberDisclose", "domainPropagate"] as const) {
      if (requested.rights[field] && !grant.rights[field])
        throw new TypeError(`Grant ${field} cannot expand`);
    }
  }
  return parseGrant({
    ...grant,
    ...requested,
    policyRevision: grant.policyRevision + 1,
    state: grant.state,
  });
}
