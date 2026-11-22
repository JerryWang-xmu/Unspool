import { ArchiveService } from "../../../apps/runner-api/src/archive/service.js";
import { ProblemError } from "../../../apps/runner-api/src/errors/problem.js";
import { CompletionGate } from "../../../apps/runner-api/src/evidence/completion-gate.js";
import { ConclusionService } from "../../../apps/runner-api/src/evidence/conclusion-service.js";
import { ImpactService } from "../../../apps/runner-api/src/evidence/impact-service.js";
import { SourceService } from "../../../apps/runner-api/src/evidence/source-service.js";
import {
  createEvidenceState,
  digestBytes,
  type EvidenceActor,
  type WorkspaceEvidenceState,
} from "../../../apps/runner-api/src/evidence/state.js";

function ok(value: unknown) {
  return { ok: true as const, value };
}
function failure(error: unknown) {
  if (error instanceof ProblemError)
    return {
      ok: false as const,
      error: {
        status: error.problem.status,
        code: error.problem.code,
        detail: error.problem.detail,
      },
    };
  return {
    ok: false as const,
    error: {
      status: 500,
      code: "internal_error",
      detail: error instanceof Error ? error.message : String(error),
    },
  };
}
const owner = (): EvidenceActor => ({
  id: "owner",
  displayName: "Owner",
  kind: "human",
  role: "owner",
  canReview: true,
  canApprove: true,
});
const reviewer = (): EvidenceActor => ({
  id: "reviewer",
  displayName: "Reviewer",
  kind: "human",
  role: "operator",
  canReview: true,
  canApprove: true,
});
const observer = (): EvidenceActor => ({
  id: "observer",
  displayName: "Observer",
  kind: "human",
  role: "observer",
  canReview: false,
  canApprove: false,
});
const agent = (): EvidenceActor => ({
  id: "agent",
  displayName: "Agent",
  kind: "agent",
  role: "contributor",
  canReview: false,
  canApprove: false,
});
const bytes = (text: string) => new TextEncoder().encode(text);

export async function createUs5Harness() {
  const conclusions = new ConclusionService();
  const sources = new SourceService();
  const impacts = new ImpactService();
  const completion = new CompletionGate();
  const archives = new ArchiveService();
  const states = new Set<WorkspaceEvidenceState>();

  function run(state: WorkspaceEvidenceState, id = "run-1") {
    const value = { id, state: "technical_complete" };
    state.runs.set(id, value);
    return value;
  }
  function confirmed(
    state: WorkspaceEvidenceState,
    sourceVersionId: string,
    body = "Confirmed conclusion",
  ) {
    const conclusion = conclusions.proposeConclusion(state, {
      actor: owner(),
      kind: "fact",
      body,
      scope: "workspace",
      sourceVersionIds: [sourceVersionId],
    });
    conclusions.reviewConclusion(state, {
      conclusionId: conclusion.id,
      actor: reviewer(),
      newState: "confirmed",
      reason: "Reviewed",
    });
    return conclusion;
  }
  function baseSource(state: WorkspaceEvidenceState, originType = "artifact") {
    return sources.addSource(state, {
      actor: owner(),
      originType,
      originId: "origin-1",
      contentRef: "artifact-1",
      contentDigest: `sha256:${"a".repeat(64)}`,
    });
  }

  return {
    seed: {
      async workspaceWithSharedSource() {
        const state = stateFactory();
        run(state);
        const { sourceVersion } = baseSource(state);
        const conclusion = confirmed(state, sourceVersion.id, "Baseline");
        return ok({
          workspaceId: state.id,
          runId: "run-1",
          owner: owner(),
          reviewer: reviewer(),
          observer: observer(),
          agent: agent(),
          sourceId: sourceVersion.sourceId,
          sourceVersionId: sourceVersion.id,
          conclusionId: conclusion.id,
        });
      },
      async sharedSourceImpact() {
        const state = stateFactory();
        run(state);
        const { source, sourceVersion } = baseSource(state);
        const first = confirmed(state, sourceVersion.id, "First conclusion");
        const second = confirmed(state, sourceVersion.id, "Second conclusion");
        const completionCriterionId = "criterion-1";
        const artifactId = "artifact-1";
        const pendingActionId = "action-1";
        state.impacts.push(
          {
            id: "impact-criterion",
            conclusionId: first.id,
            targetType: "completion_criterion",
            targetId: completionCriterionId,
            impactKind: "source_changed",
            state: "resolved",
          },
          {
            id: "impact-artifact",
            conclusionId: first.id,
            targetType: "artifact",
            targetId: artifactId,
            impactKind: "source_changed",
            state: "resolved",
          },
          {
            id: "impact-action",
            conclusionId: second.id,
            targetType: "pending_action",
            targetId: pendingActionId,
            impactKind: "source_changed",
            state: "resolved",
          },
        );
        state.artifacts.set(artifactId, {
          id: artifactId,
          name: "artifact.txt",
          bytes: bytes("artifact"),
          declaredSize: 8,
          sha256: digestBytes(bytes("artifact")),
          deleted: false,
          inaccessible: false,
        });
        state.pendingActions.set(pendingActionId, {
          id: pendingActionId,
          state: "pending",
          revoked: false,
          executed: false,
        });
        return ok({
          workspaceId: state.id,
          runId: "run-1",
          owner: owner(),
          reviewer: reviewer(),
          observer: observer(),
          sourceId: source.id,
          sourceVersionId: sourceVersion.id,
          conclusionIds: [first.id, second.id],
          completionCriterionId,
          artifactId,
          pendingActionId,
        });
      },
      async conflictingSources() {
        const state = stateFactory();
        const first = baseSource(state);
        const second = sources.addSource(state, {
          actor: owner(),
          originType: "external",
          originId: "external-2",
          contentRef: "external-2",
          contentDigest: `sha256:${"b".repeat(64)}`,
          externalMonitoring: true,
        });
        const conclusion = conclusions.proposeConclusion(state, {
          actor: owner(),
          kind: "fact",
          body: "Conflicting conclusion",
          scope: "workspace",
          sourceVersionIds: [first.sourceVersion.id],
        });
        conclusion.state = "review_required";
        state.links.push({
          conclusionId: conclusion.id,
          sourceVersionId: second.sourceVersion.id,
          relation: "conflicts",
          createdBy: owner().id,
          createdAt: new Date().toISOString(),
        });
        return ok({
          workspaceId: state.id,
          conclusionId: conclusion.id,
          conclusionBody: conclusion.body,
          sourceIds: [first.source.id, second.source.id],
          sourceVersionIds: [first.sourceVersion.id, second.sourceVersion.id],
          reviewer: reviewer(),
        });
      },
      async expiringExternalSource() {
        const state = stateFactory();
        const reviewDueAt = new Date(Date.now() + 86_400_000).toISOString();
        const lastConfirmedAt = new Date().toISOString();
        const { source, sourceVersion } = sources.addSource(state, {
          actor: owner(),
          originType: "external",
          originId: "external-due",
          contentRef: "external-due",
          contentDigest: `sha256:${"c".repeat(64)}`,
          reviewDueAt,
          externalMonitoring: false,
          recordedAt: lastConfirmedAt,
        });
        const conclusion = confirmed(state, sourceVersion.id, "Expiring conclusion");
        return ok({
          workspaceId: state.id,
          sourceId: source.id,
          sourceVersionId: sourceVersion.id,
          conclusionId: conclusion.id,
          conclusionBody: conclusion.body,
          reviewDueAt,
          lastConfirmedAt,
          reviewer: reviewer(),
        });
      },
      async completionScenario(input: { evidence: "missing" | "invalid" | "review_required" }) {
        const state = stateFactory();
        run(state);
        const conclusionIds: string[] = [];
        const sourceVersionIds: string[] = [];
        if (input.evidence === "missing") {
          const conclusion = conclusions.proposeConclusion(state, {
            actor: owner(),
            kind: "fact",
            body: "Missing evidence",
            scope: "workspace",
            sourceVersionIds: [],
          });
          conclusionIds.push(conclusion.id);
        } else {
          const { sourceVersion } = baseSource(state);
          sourceVersionIds.push(sourceVersion.id);
          const conclusion = confirmed(state, sourceVersion.id, `Evidence ${input.evidence}`);
          conclusionIds.push(conclusion.id);
          if (input.evidence === "invalid")
            sources.changeSourceState(state, {
              sourceId: sourceVersion.sourceId,
              actor: reviewer(),
              state: "invalid",
            });
          else
            conclusions.reviewConclusion(state, {
              conclusionId: conclusion.id,
              actor: reviewer(),
              newState: "review_required",
              reason: "Review required",
            });
        }
        return ok({
          workspaceId: state.id,
          runId: "run-1",
          owner: owner(),
          reviewer: reviewer(),
          observer: observer(),
          conclusionIds,
          sourceVersionIds,
        });
      },
      async archiveScenario() {
        const state = stateFactory();
        run(state, "run-1");
        run(state, "run-2");
        const { sourceVersion } = baseSource(state);
        const conclusion = confirmed(state, sourceVersion.id, "Archived conclusion");
        const presentArtifactIds = ["present-1", "present-2"];
        for (const [index, id] of presentArtifactIds.entries()) {
          const content = bytes(`present-${index + 1}`);
          state.artifacts.set(id, {
            id,
            runId: "run-1",
            name: `${id}.txt`,
            bytes: content,
            declaredSize: content.byteLength,
            sha256: digestBytes(content),
            deleted: false,
            inaccessible: false,
          });
        }
        const missingArtifactId = "missing-artifact";
        state.artifacts.set(missingArtifactId, {
          id: missingArtifactId,
          runId: "run-1",
          name: "missing.txt",
          bytes: null,
          declaredSize: 10,
          sha256: `sha256:${"d".repeat(64)}`,
          deleted: true,
          inaccessible: false,
        });
        const truncatedArtifactId = "truncated-artifact";
        const truncatedBytes = bytes("short");
        state.artifacts.set(truncatedArtifactId, {
          id: truncatedArtifactId,
          runId: "run-1",
          name: "truncated.txt",
          bytes: truncatedBytes,
          declaredSize: 20,
          sha256: digestBytes(truncatedBytes),
          deleted: false,
          inaccessible: false,
        });
        const unknownItemId = "unknown-item";
        state.artifacts.set(unknownItemId, {
          id: unknownItemId,
          name: "unknown",
          bytes: null,
          declaredSize: 0,
          sha256: `sha256:${"e".repeat(64)}`,
          deleted: false,
          inaccessible: false,
          unknown: true,
        });
        state.status = "archived";
        return ok({
          workspaceId: state.id,
          workspaceName: state.name,
          runId: "run-1",
          otherRunId: "run-2",
          owner: owner(),
          reviewer: reviewer(),
          observer: observer(),
          conclusionId: conclusion.id,
          presentArtifactIds,
          missingArtifactId,
          truncatedArtifactId,
          unknownItemId,
        });
      },
    },
    async proposeConclusion(input: any) {
      try {
        return ok(conclusions.proposeConclusion(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async reviewConclusion(input: any) {
      try {
        return ok(conclusions.reviewConclusion(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async changeSourceState(input: any) {
      try {
        return ok(sources.changeSourceState(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async recordEvidenceException(input: any) {
      try {
        return ok(conclusions.recordEvidenceException(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async getReviewHistory(input: any) {
      try {
        return ok(conclusions.getReviewHistory(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async recordSourceVersion(input: any) {
      try {
        return ok(sources.recordSourceVersion(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async getSourceVersion(input: any) {
      try {
        return ok(sources.getSourceVersion(current(input.workspaceId), input.sourceVersionId));
      } catch (error) {
        return failure(error);
      }
    },
    async getImpactView(input: any) {
      try {
        return ok(impacts.getImpactView(current(input.workspaceId)));
      } catch (error) {
        return failure(error);
      }
    },
    async evaluateDueSources(input: any) {
      try {
        return ok(sources.evaluateDueSources(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async inspectArtifact(input: any) {
      try {
        return ok(impacts.inspectArtifact(current(input.workspaceId), input.artifactId));
      } catch (error) {
        return failure(error);
      }
    },
    async inspectPendingAction(input: any) {
      try {
        return ok(impacts.inspectPendingAction(current(input.workspaceId), input.actionId));
      } catch (error) {
        return failure(error);
      }
    },
    async assessCompletion(input: any) {
      try {
        return ok(completion.assessCompletion(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async addSupportingEvidence(input: any) {
      try {
        const state = current(input.workspaceId);
        const added = sources.addSource(state, {
          actor: input.actor,
          originType: input.originType,
          originId: input.originId,
          contentRef: input.contentRef,
          contentDigest: input.contentDigest,
        });
        state.links.push({
          conclusionId: input.conclusionId,
          sourceVersionId: added.sourceVersion.id,
          relation: "supports",
          createdBy: input.actor.id,
          createdAt: new Date().toISOString(),
        });
        return ok({ sourceId: added.source.id, sourceVersionId: added.sourceVersion.id });
      } catch (error) {
        return failure(error);
      }
    },
    async getCompletionState(input: any) {
      try {
        return ok(completion.getCompletionState(current(input.workspaceId), input.runId));
      } catch (error) {
        return failure(error);
      }
    },
    async archiveWorkspace(input: any) {
      try {
        return ok(archives.archiveWorkspace(current(input.workspaceId), input.actor));
      } catch (error) {
        return failure(error);
      }
    },
    async attemptMutationAfterArchive(input: any) {
      try {
        return ok(archives.attemptMutationAfterArchive(current(input.workspaceId)));
      } catch (error) {
        return failure(error);
      }
    },
    async exportArchive(input: any) {
      try {
        return ok(archives.exportArchive(current(input.workspaceId), input));
      } catch (error) {
        return failure(error);
      }
    },
    async getArchiveManifest(input: any) {
      try {
        return ok(archives.getArchiveManifest(current(input.workspaceId), input.exportId));
      } catch (error) {
        return failure(error);
      }
    },
    async getArtifactBytes(input: any) {
      try {
        return ok(archives.getArtifactBytes(current(input.workspaceId), input.artifactId));
      } catch (error) {
        return failure(error);
      }
    },
    async getExportAudit(input: any) {
      try {
        return ok(archives.getExportAudit(current(input.workspaceId)));
      } catch (error) {
        return failure(error);
      }
    },
    async close() {
      states.clear();
    },
  };

  function current(workspaceId: string): WorkspaceEvidenceState {
    const found = [...states].find((state) => state.id === workspaceId);
    if (found === undefined) throw new ProblemError("not_found");
    return found;
  }
  function stateFactory(): WorkspaceEvidenceState {
    const value = createEvidenceState("us5");
    states.add(value);
    return value;
  }
}
