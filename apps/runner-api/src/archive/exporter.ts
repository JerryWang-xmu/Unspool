import { digestBytes, type EvidenceActor, type WorkspaceEvidenceState } from "../evidence/state.js";

export function buildArchiveManifest(
  state: WorkspaceEvidenceState,
  actor: EvidenceActor,
  scope: string,
  runIds: readonly string[] | undefined,
  exportedAt: string,
) {
  const selectedRunIds =
    scope === "selected_tasks" && runIds !== undefined ? new Set(runIds) : undefined;
  const runs = [...state.runs.values()]
    .filter((run) => selectedRunIds === undefined || selectedRunIds.has(run.id))
    .map((run) => ({
      id: run.id,
      state: run.state,
      ...(run.result === undefined ? {} : { result: run.result }),
    }));
  const conclusions = [...state.conclusions.values()].map((conclusion) => ({
    ...conclusion,
    sources: state.links
      .filter((link) => link.conclusionId === conclusion.id)
      .map((link) => ({ sourceVersionId: link.sourceVersionId, relation: link.relation })),
    reviews: state.reviews.filter((review) => review.conclusionId === conclusion.id),
  }));
  const artifacts = [...state.artifacts.values()]
    .filter(
      (artifact) =>
        artifact.unknown !== true &&
        (selectedRunIds === undefined ||
          artifact.runId === undefined ||
          selectedRunIds.has(artifact.runId)),
    )
    .map((artifact) => {
      const status =
        artifact.unknown === true
          ? "unknown"
          : artifact.inaccessible
            ? "inaccessible"
            : artifact.deleted || artifact.bytes === null
              ? "missing"
              : artifact.bytes.byteLength < artifact.declaredSize
                ? "truncated"
                : "present";
      return {
        id: artifact.id,
        name: artifact.name,
        ...(artifact.runId === undefined ? {} : { runId: artifact.runId }),
        sha256: artifact.sha256,
        size: artifact.declaredSize,
        path: `artifacts/${artifact.id}`,
        status,
      };
    });
  return {
    formatVersion: 1,
    exportedAt,
    exportedBy: actor.id,
    scope,
    workspace: {
      id: state.id,
      name: state.name,
      status: state.status,
      goal: state.goal,
      completionCriteria: state.completionCriteria,
    },
    runs,
    conclusions,
    completionAssessments: [...state.assessments],
    exceptions: [...state.exceptions],
    artifacts,
    missingItems: artifacts
      .filter((artifact) => ["missing", "truncated", "inaccessible"].includes(artifact.status))
      .map((artifact) => artifact.id),
    unknownItems: [...state.artifacts.values()]
      .filter((artifact) => artifact.unknown === true)
      .map((artifact) => artifact.id),
  };
}

export function serializeArchiveManifest(manifest: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}

export function archiveManifestDigest(bytes: Uint8Array): string {
  return digestBytes(bytes);
}
