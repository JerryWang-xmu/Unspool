import type { B1PatchProposal } from "../../test-support/src/federation/tool-fixtures.js";
import { fedDigest, federationDigest, fedObject, fedText } from "./federation-validation.js";

export type PatchProposalState =
  | "proposed"
  | "conflict"
  | "rejected"
  | "application_approved"
  | "applied"
  | "outcome_unknown";
export type PatchProposal = Omit<B1PatchProposal, "state"> & { readonly state: PatchProposalState };

export function parsePatchProposal(value: unknown): PatchProposal {
  const input = fedObject(value, "PatchProposal");
  const fileChanges = Array.isArray(input.fileChanges)
    ? input.fileChanges
    : (() => {
        throw new TypeError("PatchProposal.fileChanges must be an array");
      })();
  if (fileChanges.length === 0) throw new RangeError("PatchProposal.fileChanges must not be empty");
  for (const [index, change] of fileChanges.entries()) {
    const record = fedObject(change, `PatchProposal.fileChanges[${index}]`);
    const path = fedText(record.path, `PatchProposal.fileChanges[${index}].path`);
    if (path.includes("..") || path.startsWith("/") || path.includes("\\"))
      throw new RangeError("patch_path_denied");
    fedDigest(record.baseDigest, "PatchProposal.fileChanges.baseDigest");
    fedDigest(record.replacementDigest, "PatchProposal.fileChanges.replacementDigest");
  }
  return {
    id: fedText(input.id, "PatchProposal.id"),
    nodeId: fedText(input.nodeId, "PatchProposal.nodeId"),
    baseSnapshotId: fedText(input.baseSnapshotId, "PatchProposal.baseSnapshotId"),
    baseManifestDigest: fedDigest(
      input.baseManifestDigest,
      "PatchProposal.baseManifestDigest",
    ) as PatchProposal["baseManifestDigest"],
    fileChanges: fileChanges as PatchProposal["fileChanges"],
    runId: fedText(input.runId, "PatchProposal.runId"),
    purposeDigest: fedDigest(
      input.purposeDigest,
      "PatchProposal.purposeDigest",
    ) as PatchProposal["purposeDigest"],
    patchDigest: fedDigest(
      input.patchDigest,
      "PatchProposal.patchDigest",
    ) as PatchProposal["patchDigest"],
    securityLabelId: fedText(input.securityLabelId, "PatchProposal.securityLabelId"),
    state: fedText(input.state, "PatchProposal.state") as B1PatchProposal["state"],
  };
}

export function patchProposalDigest(proposal: PatchProposal): string {
  return federationDigest(
    proposal.fileChanges.map((change) => ({
      path: change.path,
      baseDigest: change.baseDigest,
      replacementDigest: change.replacementDigest,
    })),
  );
}

export function transitionPatchProposal(
  proposal: PatchProposal,
  next: PatchProposalState,
): PatchProposal {
  const allowed: Record<PatchProposalState, readonly PatchProposalState[]> = {
    proposed: ["application_approved", "conflict", "rejected", "outcome_unknown"],
    application_approved: ["applied", "conflict", "outcome_unknown"],
    conflict: [],
    rejected: [],
    applied: [],
    outcome_unknown: [],
  };
  if (!allowed[proposal.state].includes(next)) throw new RangeError("patch_terminal");
  return { ...proposal, state: next };
}
