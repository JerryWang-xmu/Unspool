import { ProblemError } from "../errors/problem.js";
import {
  assertMutable,
  digestBytes,
  type EvidenceActor,
  evidenceId,
  evidenceNow,
  requireEntity,
  type WorkspaceEvidenceState,
} from "../evidence/state.js";
import { buildArchiveManifest, serializeArchiveManifest } from "./exporter.js";

export class ArchiveService {
  archiveWorkspace(state: WorkspaceEvidenceState, actor: EvidenceActor) {
    if (actor.role !== "owner") throw new ProblemError("permission_denied");
    state.status = "archived";
    return { id: state.id, status: state.status };
  }

  attemptMutationAfterArchive(state: WorkspaceEvidenceState) {
    assertMutable(state);
    throw new ProblemError("workspace_archived");
  }

  exportArchive(
    state: WorkspaceEvidenceState,
    input: { actor: EvidenceActor; scope: string; runIds?: string[] },
  ) {
    const now = evidenceNow();
    const manifest = buildArchiveManifest(state, input.actor, input.scope, input.runIds, now);
    const bytes = serializeArchiveManifest(manifest);
    const exported = {
      id: evidenceId(),
      workspaceId: state.id,
      scope: input.scope,
      formatVersion: 1,
      manifestBlobId: evidenceId(),
      missingItems: manifest.missingItems,
      unknownItems: manifest.unknownItems,
      exportedBy: input.actor.id,
      exportedAt: now,
    };
    state.exports.set(exported.id, { ...exported, bytes, manifest, mediaType: "application/json" });
    return exported;
  }

  getArchiveManifest(state: WorkspaceEvidenceState, exportId: string) {
    const exported = requireEntity(state.exports.get(exportId));
    return { mediaType: exported.mediaType, bytes: exported.bytes, manifest: exported.manifest };
  }

  getArtifactBytes(state: WorkspaceEvidenceState, artifactId: string) {
    const artifact = requireEntity(state.artifacts.get(artifactId));
    if (artifact.deleted || artifact.bytes === null) throw new ProblemError("not_found");
    if (artifact.inaccessible) throw new ProblemError("permission_denied");
    return {
      bytes: artifact.bytes,
      sha256: digestBytes(artifact.bytes),
      size: artifact.declaredSize,
      truncated: artifact.bytes.byteLength < artifact.declaredSize,
    };
  }

  getExportAudit(state: WorkspaceEvidenceState) {
    return [...state.exports.values()].map(
      ({ bytes: _bytes, manifest: _manifest, mediaType: _mediaType, ...exported }) => exported,
    );
  }

  searchArchive(state: WorkspaceEvidenceState, query: string) {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return { conclusions: [], artifacts: [] };
    return {
      conclusions: [...state.conclusions.values()].filter((conclusion) =>
        conclusion.body.toLowerCase().includes(normalized),
      ),
      artifacts: [...state.artifacts.values()].filter(
        (artifact) => artifact.unknown !== true && artifact.name.toLowerCase().includes(normalized),
      ),
    };
  }
}
