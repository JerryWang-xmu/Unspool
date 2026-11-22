import { ProblemError } from "../errors/problem.js";
import {
  actorCanMutate,
  actorCanReview,
  assertMutable,
  type EvidenceActor,
  evidenceId,
  requireEntity,
  requireReason,
  type WorkspaceEvidenceState,
} from "./state.js";

export interface ConclusionServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class ConclusionService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: ConclusionServiceOptions & { database?: unknown } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? evidenceId;
  }

  async list(actorId: string, workspaceId: string): Promise<{ items: Record<string, unknown>[] }> {
    void actorId;
    void workspaceId;
    return { items: [] };
  }

  proposeConclusion(
    state: WorkspaceEvidenceState,
    input: {
      actor: EvidenceActor;
      kind: string;
      body: string;
      scope: string;
      sourceVersionIds: string[];
    },
  ) {
    assertMutable(state);
    actorCanMutate(input.actor);
    const body = requireReason(input.body);
    const scope = requireReason(input.scope);
    for (const versionId of input.sourceVersionIds)
      requireEntity(state.sourceVersions.get(versionId), "evidence_incomplete");
    const now = this.#now().toISOString();
    const conclusion = {
      id: this.#newId(),
      workspaceId: state.id,
      kind: input.kind,
      body,
      state: "unverified",
      scope,
      proposedBy: input.actor.id,
      currentVersion: 1,
      sourceVersionIds: [...input.sourceVersionIds],
    };
    state.conclusions.set(conclusion.id, conclusion);
    for (const sourceVersionId of input.sourceVersionIds) {
      state.links.push({
        conclusionId: conclusion.id,
        sourceVersionId,
        relation: "supports",
        createdBy: input.actor.id,
        createdAt: now,
      });
    }
    return conclusion;
  }

  reviewConclusion(
    state: WorkspaceEvidenceState,
    input: {
      conclusionId: string;
      actor: EvidenceActor;
      newState: "confirmed" | "review_required" | "invalid";
      reason: string;
      sourceVersionIds?: string[];
    },
  ) {
    assertMutable(state);
    actorCanReview(input.actor);
    const reason = requireReason(input.reason);
    const conclusion = requireEntity(state.conclusions.get(input.conclusionId));
    const sourceVersionIds =
      input.sourceVersionIds ??
      state.links
        .filter((link) => link.conclusionId === conclusion.id)
        .map((link) => link.sourceVersionId);
    if (input.newState === "confirmed") {
      for (const versionId of sourceVersionIds) {
        const version = requireEntity(state.sourceVersions.get(versionId), "evidence_incomplete");
        const source = requireEntity(state.sources.get(version.sourceId), "evidence_incomplete");
        if (source.currentVersionId !== versionId || source.state !== "active")
          throw new ProblemError("evidence_incomplete");
      }
    }
    const previousState = conclusion.state;
    const now = this.#now().toISOString();
    conclusion.state = input.newState;
    conclusion.currentVersion += 1;
    conclusion.lastReviewedAt = now;
    conclusion.confirmedBy = input.newState === "confirmed" ? input.actor.id : undefined;
    conclusion.confirmedAt = input.newState === "confirmed" ? now : undefined;
    conclusion.sourceVersionIds = [...sourceVersionIds];
    const review = {
      id: this.#newId(),
      conclusionId: conclusion.id,
      previousState,
      newState: input.newState,
      reason,
      sourceVersionIds: [...sourceVersionIds],
      reviewedBy: input.actor.id,
      reviewedAt: now,
    };
    state.reviews.push(review);
    for (const impact of state.impacts) {
      if (impact.conclusionId === conclusion.id) impact.state = "resolved";
    }
    return { conclusion, review };
  }

  getReviewHistory(
    _state: WorkspaceEvidenceState,
    input: { conclusionId: string; actor: EvidenceActor },
  ) {
    void input.actor;
    return input.conclusionId === undefined
      ? []
      : structuredClone(
          _state.reviews.filter((review) => review.conclusionId === input.conclusionId),
        );
  }

  recordEvidenceException(
    state: WorkspaceEvidenceState,
    input: { runId: string; conclusionIds: string[]; actor: EvidenceActor; reason: string },
  ) {
    assertMutable(state);
    if (input.actor.role !== "owner") throw new ProblemError("permission_denied");
    const reason = requireReason(input.reason);
    if (input.conclusionIds.length === 0) throw new ProblemError("invalid_request");
    for (const id of input.conclusionIds) requireEntity(state.conclusions.get(id));
    const exception = {
      id: this.#newId(),
      runId: input.runId,
      conclusionIds: [...input.conclusionIds],
      reason,
      approvedBy: input.actor.id,
      createdAt: this.#now().toISOString(),
    };
    state.exceptions.push(exception);
    return exception;
  }
}
