import type { SecurityLabel } from "../../contracts/src/security-label.js";

export interface DefaultLabelOptions {
  id: string;
  purpose: string;
  untrustedContent?: boolean | undefined;
}

/** Creates the Stable label without depending on Beta RecipientRules or node components. */
export function createDefaultSecurityLabel(options: DefaultLabelOptions): SecurityLabel {
  return {
    id: options.id,
    version: 1,
    purposeRules: [options.purpose],
    memberRules: ["workspace_members"],
    modelRecipientRules: [],
    targetDomainRules: [],
    publicVisibility: false,
    cacheAndRetention: { centralCache: false, offlineRead: false, retentionSeconds: 0 },
    untrustedContent: options.untrustedContent ?? true,
    reviewHistory: [],
  };
}
