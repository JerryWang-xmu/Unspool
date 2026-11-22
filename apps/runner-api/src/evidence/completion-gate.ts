import { ProblemError } from "../errors/problem.js";
import {
  assertMutable,
  type EvidenceActor,
  evidenceId,
  evidenceNow,
  requireReason,
  type WorkspaceEvidenceState,
} from "./state.js";

export class CompletionGate {
  assessCompletion(
    state: WorkspaceEvidenceState,
    input: {
      runId: string;
      actor: EvidenceActor;
      result: string;
      reason?: string;
      evidenceExceptionReason?: string;
    },
  ) {
    assertMutable(state);
    const conclusions = [...state.conclusions.values()];
    const blockingConclusionIds: string[] = [];
    let validEvidence = 0;
    for (const conclusion of conclusions) {
      const links = state.links.filter((link) => link.conclusionId === conclusion.id);
      const valid =
        conclusion.state === "confirmed" &&
        links.length > 0 &&
        links.every((link) => {
          const version = state.sourceVersions.get(link.sourceVersionId);
          const source = version === undefined ? undefined : state.sources.get(version.sourceId);
          return (
            source !== undefined &&
            source.state === "active" &&
            source.currentVersionId === link.sourceVersionId
          );
        });
      if (valid) validEvidence += 1;
      else blockingConclusionIds.push(conclusion.id);
    }
    const requiredEvidence = conclusions.length;
    const coverage = {
      validEvidence,
      requiredEvidence,
      ratio: requiredEvidence === 0 ? 1 : validEvidence / requiredEvidence,
      exceptionCounted: false,
    };
    let exception: any;
    if (input.result === "complete" && blockingConclusionIds.length > 0) {
      if (input.evidenceExceptionReason === undefined)
        throw new ProblemError("evidence_incomplete");
      if (input.actor.role !== "owner") throw new ProblemError("permission_denied");
      const reason = requireReason(input.evidenceExceptionReason);
      exception = {
        id: evidenceId(),
        runId: input.runId,
        conclusionIds: [...blockingConclusionIds],
        reason,
        approvedBy: input.actor.id,
        createdAt: evidenceNow(),
      };
      state.exceptions.push(exception);
    }
    const assessment = {
      runId: input.runId,
      result: input.result,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      assessedBy: input.actor.id,
      assessedAt: evidenceNow(),
      ...(exception === undefined ? {} : { evidenceExceptionId: exception.id }),
    };
    state.assessments.push(assessment);
    const run = state.runs.get(input.runId);
    if (run !== undefined) run.result = input.result;
    return {
      assessment,
      coverage,
      blockingConclusionIds,
      ...(exception === undefined ? {} : { exception }),
    };
  }

  getCompletionState(state: WorkspaceEvidenceState, runId: string) {
    return {
      runResult: state.runs.get(runId)?.result,
      assessments: state.assessments.filter((assessment) => assessment.runId === runId),
      exceptions: state.exceptions.filter((exception) => exception.runId === runId),
    };
  }
}
