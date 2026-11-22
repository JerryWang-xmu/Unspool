import { createHash } from "node:crypto";
import type {
  B1ArtifactVersion,
  B1CrossDomainRecipient,
  B1DataRights,
  B1TransferApproval,
} from "../../../../packages/test-support/src/federation/tool-fixtures.js";
import { type ArtifactTransferResult, transferArtifact } from "./artifact-transfer.js";

export interface SourceArtifactBytes {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mediaType: string;
  readonly sourceSummary: string;
  readonly contentDigest: string;
}

export interface ArtifactTransferIoInput {
  readonly artifact: B1ArtifactVersion & {
    readonly contentDigest: string;
    readonly originOwnerIds: readonly string[];
  };
  readonly recipient: B1CrossDomainRecipient;
  readonly sourceLabelRights: B1DataRights;
  readonly recipientLabelRights: B1DataRights;
  readonly requestedRights: B1DataRights;
  readonly loadApprovals: () => Promise<readonly B1TransferApproval[]>;
  readonly loadSource: () => Promise<SourceArtifactBytes>;
  readonly storeRecipient: (
    source: SourceArtifactBytes,
    derived: ArtifactTransferResult["derivedSecurityLabel"],
  ) => Promise<{ artifactId: string; artifactVersionId: string }>;
}

/** Policy first, then authenticated source bytes, then one recipient write. */
export async function transferArtifactBytes(input: ArtifactTransferIoInput): Promise<
  ArtifactTransferResult & {
    readonly recipientArtifact: { artifactId: string; artifactVersionId: string };
  }
> {
  const approvals = await input.loadApprovals();
  const approved = transferArtifact({
    ...input,
    approvals,
    federationLevel: "snapshot_tools_patch",
  });
  const source = await input.loadSource();
  const actual = `sha256:${createHash("sha256").update(source.bytes).digest("hex")}`;
  if (actual !== input.artifact.contentDigest || actual !== source.contentDigest)
    throw new Error("artifact_content_digest_mismatch");
  const recipientArtifact = await input.storeRecipient(source, approved.derivedSecurityLabel);
  return { ...approved, recipientArtifact };
}
