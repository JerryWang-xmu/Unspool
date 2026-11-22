import type { JsonObject } from "../../domain/src/validation.js";
import {
  boolean,
  integer,
  object,
  objectArray,
  text,
  textArray,
} from "../../domain/src/validation.js";

export interface SecurityLabel {
  id: string;
  version: number;
  purposeRules: string[];
  memberRules: string[];
  modelRecipientRules: string[];
  targetDomainRules: string[];
  publicVisibility: boolean;
  cacheAndRetention: JsonObject;
  untrustedContent: boolean;
  reviewHistory: JsonObject[];
}

export function parseSecurityLabel(value: unknown): SecurityLabel {
  const input = object(value, "SecurityLabel");
  return {
    id: text(input.id, "SecurityLabel.id"),
    version: integer(input.version, "SecurityLabel.version", 1),
    purposeRules: textArray(input.purposeRules, "SecurityLabel.purposeRules"),
    memberRules: textArray(input.memberRules, "SecurityLabel.memberRules"),
    modelRecipientRules: textArray(input.modelRecipientRules, "SecurityLabel.modelRecipientRules"),
    targetDomainRules: textArray(input.targetDomainRules, "SecurityLabel.targetDomainRules"),
    publicVisibility: boolean(input.publicVisibility, "SecurityLabel.publicVisibility"),
    cacheAndRetention: object(input.cacheAndRetention, "SecurityLabel.cacheAndRetention"),
    untrustedContent: boolean(input.untrustedContent, "SecurityLabel.untrustedContent"),
    reviewHistory: objectArray(input.reviewHistory, "SecurityLabel.reviewHistory"),
  };
}
