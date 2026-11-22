import { requireEntity, type WorkspaceEvidenceState } from "./state.js";

export class ImpactService {
  getImpactView(state: WorkspaceEvidenceState) {
    const conclusions = [...state.conclusions.values()].map((conclusion) => {
      const links = state.links.filter((link) => link.conclusionId === conclusion.id);
      const sources = links.map((link) => {
        const version = requireEntity(state.sourceVersions.get(link.sourceVersionId));
        const source = requireEntity(state.sources.get(version.sourceId));
        return {
          sourceId: source.id,
          sourceVersionId: version.id,
          relation: link.relation,
          state: source.state,
          originType: source.originType,
          originId: source.originId,
          contentDigest: version.contentDigest,
          lastConfirmedAt: source.lastConfirmedAt,
          externalMonitoring: source.externalMonitoring,
        };
      });
      const impacts = state.impacts.filter((impact) => impact.conclusionId === conclusion.id);
      return {
        ...conclusion,
        reviewRequired:
          conclusion.state === "review_required" ||
          impacts.some((impact) => impact.state === "review_required"),
        sources,
        impacts,
      };
    });
    const conflictGroups = conclusions
      .filter(
        (conclusion) =>
          new Set(conclusion.sources.map((source: any) => source.sourceId)).size > 1 ||
          conclusion.sources.some((source: any) => source.relation === "conflicts"),
      )
      .map((conclusion) => ({
        conclusionId: conclusion.id,
        sources: conclusion.sources.map((source: any) => ({
          sourceId: source.sourceId,
          sourceVersionId: source.sourceVersionId,
          contentDigest: source.contentDigest,
          lastConfirmedAt: source.lastConfirmedAt,
        })),
        resolved: false,
      }));
    const externalSources = [...state.sources.values()].filter(
      (source) => source.originType === "external",
    );
    const externalVerification =
      externalSources.length === 0
        ? "unknown"
        : externalSources.every((source) => source.externalMonitoring)
          ? "monitored"
          : "not_monitored";
    return {
      conclusions,
      impacts: [...state.impacts],
      conflictGroups,
      notificationCountBySource: { ...state.notificationCountBySource },
      externalVerification,
    };
  }

  inspectArtifact(state: WorkspaceEvidenceState, artifactId: string) {
    const artifact = requireEntity(state.artifacts.get(artifactId));
    return {
      id: artifact.id,
      sha256: artifact.sha256,
      size: artifact.declaredSize,
      exists: artifact.bytes !== null,
      deleted: artifact.deleted,
    };
  }

  inspectPendingAction(state: WorkspaceEvidenceState, actionId: string) {
    const action = requireEntity(state.pendingActions.get(actionId));
    return { ...action };
  }
}
