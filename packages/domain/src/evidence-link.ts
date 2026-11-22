import { object, text, timestamp } from "./validation.js";
export const EVIDENCE_RELATIONS = ["supports", "conflicts", "context"] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];
export interface EvidenceLink {
  conclusionId: string;
  sourceVersionId: string;
  relation: EvidenceRelation;
  createdBy: string;
  createdAt: string;
}
export function createEvidenceLink(input: EvidenceLink): EvidenceLink {
  const value = object(input, "EvidenceLink");
  const relation = text(value.relation, "EvidenceLink.relation") as EvidenceRelation;
  if (!EVIDENCE_RELATIONS.includes(relation))
    throw new TypeError(`Unsupported EvidenceLink.relation: ${relation}`);
  return Object.freeze({
    conclusionId: text(value.conclusionId, "EvidenceLink.conclusionId"),
    sourceVersionId: text(value.sourceVersionId, "EvidenceLink.sourceVersionId"),
    relation,
    createdBy: text(value.createdBy, "EvidenceLink.createdBy"),
    createdAt: timestamp(value.createdAt, "EvidenceLink.createdAt"),
  });
}
