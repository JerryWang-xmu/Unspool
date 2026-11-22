import type {
  B1ArtifactVersion,
  B1CrossDomainRecipient,
  B1DataRights,
  B1TransferApproval,
} from "../../../../packages/test-support/src/federation/tool-fixtures.js";
import { intersectDataRights } from "./propagation.js";

export interface ArtifactTransferResult {
  readonly state: "approved";
  readonly payload: { artifactVersionId: string; contentDigest: string };
  readonly derivedSecurityLabel: ReturnType<typeof intersectDataRights>;
  readonly recipientArtifactVersions: 1;
}

export function transferArtifact(input: {
  readonly artifact: B1ArtifactVersion & {
    readonly contentDigest: string;
    readonly originOwnerIds: readonly string[];
  };
  readonly recipient: B1CrossDomainRecipient;
  readonly sourceLabelRights: B1DataRights;
  readonly recipientLabelRights: B1DataRights;
  readonly requestedRights: B1DataRights;
  readonly approvals: readonly B1TransferApproval[];
  readonly federationLevel?: "snapshot" | "snapshot_tools" | "snapshot_tools_patch";
}): ArtifactTransferResult {
  if (input.federationLevel !== "snapshot_tools_patch")
    throw new Error("cross_domain_transfer_disabled");
  const sourceApproved = input.approvals.some(
    (approval) =>
      approval.approverRole === "source_owner" &&
      approval.approverId === input.artifact.originOwnerIds[0] &&
      approval.decision === "approved",
  );
  const recipientApproved = input.approvals.some(
    (approval) =>
      approval.approverRole === "recipient_owner" &&
      approval.approverId === input.recipient.ownerId &&
      approval.decision === "approved",
  );
  if (!sourceApproved) throw new Error("source_approval_required");
  if (!recipientApproved) {
    const error = new Error("recipient_approval_required");
    Object.assign(error, { payloadBytes: 0, recipientArtifactVersions: 0 });
    throw error;
  }
  const derivedSecurityLabel = intersectDataRights(
    input.sourceLabelRights,
    input.recipientLabelRights,
    input.requestedRights,
  );
  if (!derivedSecurityLabel.rights.domainPropagate) throw new Error("domain_propagate_denied");
  if (derivedSecurityLabel.ownerReviewRequired) throw new Error("owner_review_required");
  return {
    state: "approved",
    payload: { artifactVersionId: input.artifact.id, contentDigest: input.artifact.contentDigest },
    derivedSecurityLabel,
    recipientArtifactVersions: 1,
  };
}
