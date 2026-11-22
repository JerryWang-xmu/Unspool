import { createHash } from "node:crypto";
import { win32 } from "node:path";
import type {
  B1PatchFileResult,
  B1PatchProposal,
} from "../../../../packages/test-support/src/federation/tool-fixtures.js";

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createPatchProposal(
  input: Omit<B1PatchProposal, "patchDigest" | "state">,
): B1PatchProposal {
  if (input.fileChanges.length === 0) throw new Error("patch_selection_required");
  for (const change of input.fileChanges) {
    if (
      change.path.length === 0 ||
      change.path.includes("..") ||
      change.path.startsWith("/") ||
      change.path.includes("\\") ||
      win32.isAbsolute(change.path) ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Paths containing controls are deliberately denied.
      /[\u0000\r\n]/.test(change.path)
    )
      throw new Error("patch_path_denied");
    if (digest(change.replacementContent) !== change.replacementDigest)
      throw new Error("patch_replacement_digest_mismatch");
  }
  const patchDigest = digest(
    JSON.stringify(
      input.fileChanges.map((change) => ({
        path: change.path,
        baseDigest: change.baseDigest,
        replacementDigest: change.replacementDigest,
      })),
    ),
  );
  return {
    ...input,
    patchDigest: patchDigest as B1PatchProposal["patchDigest"],
    state: "proposed",
  };
}

export interface PatchApplicationResult {
  readonly state: "applied" | "partially_applied" | "conflict";
  readonly resultByFile: readonly B1PatchFileResult[];
  readonly journalRef: string;
  readonly writeCount: number;
  readonly outputArtifactVersions: number;
  readonly autoMerge: false;
  readonly writebackToSource: false;
}

export function applyPatch(input: {
  readonly proposal: B1PatchProposal;
  readonly independentGrantId: string | undefined;
  readonly currentFileDigests: Readonly<Record<string, string>>;
  readonly journalRef?: string;
}): PatchApplicationResult {
  if (input.independentGrantId === undefined || input.independentGrantId.length === 0)
    throw new Error("independent_grant_required");
  const results: B1PatchFileResult[] = [];
  let writeCount = 0;
  let conflicts = 0;
  for (const change of input.proposal.fileChanges) {
    if (input.currentFileDigests[change.path] !== change.baseDigest) {
      conflicts += 1;
      results.push({ path: change.path, outcome: "conflict" });
    } else {
      writeCount += 1;
      results.push({
        path: change.path,
        outcome: "applied",
        resultDigest: change.replacementDigest,
      });
    }
  }
  return {
    state: conflicts === 0 ? "applied" : writeCount === 0 ? "conflict" : "partially_applied",
    resultByFile: results,
    journalRef: input.journalRef ?? `journal://${input.proposal.id}`,
    writeCount,
    outputArtifactVersions: writeCount,
    autoMerge: false,
    writebackToSource: false,
  };
}
