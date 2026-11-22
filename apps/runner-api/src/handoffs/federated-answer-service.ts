import {
  answerPreparationQuestion,
  type PreparationAnswer,
} from "../../../../packages/pi-adapter/src/preparation-adapter.js";
import type { B0Grant } from "../../../../packages/test-support/src/federation/fixtures.js";
import type { PreparationSource } from "./preparation-service.js";

export interface FederatedPreparationSource extends PreparationSource {
  readonly grant: B0Grant;
  readonly contentDigest: string;
}

function canRecipientRead(
  source: FederatedPreparationSource,
  actorId: string,
  now: Date,
  verifyGrant: (grant: B0Grant) => boolean,
): boolean {
  const { grant } = source;
  const nowMs = now.getTime();
  if (grant.state !== "active" || !verifyGrant(grant)) return false;
  if (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
    return false;
  if (!grant.operations.includes("snapshot.read") || grant.rights.memberDisclose !== true)
    return false;
  if (grant.resourceId !== source.sourceId || grant.resourceDigest !== source.contentDigest)
    return false;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(Date.parse(grant.notBefore)) ||
    !Number.isFinite(Date.parse(grant.expiresAt))
  )
    return false;
  return Date.parse(grant.notBefore) <= nowMs && Date.parse(grant.expiresAt) > nowMs;
}

/** Applies recipient Grant filtering before invoking the shared preparation answer service. */
export function answerFederatedPreparationQuestion(input: {
  readonly question: string;
  readonly actorId: string;
  readonly now: Date;
  readonly sources: readonly FederatedPreparationSource[];
  readonly verifyGrant: (grant: B0Grant) => boolean;
}): PreparationAnswer {
  const sources = input.sources.filter((source) =>
    canRecipientRead(source, input.actorId, input.now, input.verifyGrant),
  );
  return answerPreparationQuestion(input.question, sources);
}
