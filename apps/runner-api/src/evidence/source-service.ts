import { ProblemError } from "../errors/problem.js";
import {
  actorCanReview,
  assertMutable,
  type EvidenceActor,
  evidenceId,
  requireDigest,
  requireEntity,
  requireReason,
  type WorkspaceEvidenceState,
} from "./state.js";

export interface SourceServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class SourceService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: SourceServiceOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? evidenceId;
  }

  addSource(
    state: WorkspaceEvidenceState,
    input: {
      actor: EvidenceActor;
      originType: string;
      originId: string;
      contentRef: string;
      contentDigest: string;
      reviewDueAt?: string;
      externalMonitoring?: boolean;
      recordedAt?: string;
    },
  ) {
    assertMutable(state);
    const now = input.recordedAt ?? this.#now().toISOString();
    const source = {
      id: this.#newId(),
      workspaceId: state.id,
      originType: input.originType,
      originId: input.originId,
      currentVersionId: "",
      state: "active",
      lastConfirmedAt: now,
      ...(input.reviewDueAt === undefined ? {} : { reviewDueAt: input.reviewDueAt }),
      externalMonitoring: input.externalMonitoring === true,
    };
    const version = {
      id: this.#newId(),
      sourceId: source.id,
      version: 1,
      contentRef: input.contentRef,
      contentDigest: requireDigest(input.contentDigest),
      recordedAt: now,
    };
    source.currentVersionId = version.id;
    state.sources.set(source.id, source);
    state.sourceVersions.set(version.id, version);
    return { source, sourceVersion: version, sourceVersionId: version.id };
  }

  recordSourceVersion(
    state: WorkspaceEvidenceState,
    input: {
      sourceId: string;
      actor: EvidenceActor;
      contentRef: string;
      contentDigest: string;
      recordedAt?: string;
      supersedesId?: string;
    },
  ) {
    assertMutable(state);
    actorCanReview(input.actor);
    const source = requireEntity(state.sources.get(input.sourceId));
    const previousVersionId = source.currentVersionId;
    const versionNumber =
      Math.max(
        0,
        ...[...state.sourceVersions.values()]
          .filter((version) => version.sourceId === source.id)
          .map((version) => version.version),
      ) + 1;
    const version = {
      id: this.#newId(),
      sourceId: source.id,
      version: versionNumber,
      contentRef: requireReason(input.contentRef),
      contentDigest: requireDigest(input.contentDigest),
      recordedAt: input.recordedAt ?? this.#now().toISOString(),
      supersedesId: input.supersedesId ?? previousVersionId,
    };
    state.sourceVersions.set(version.id, version);
    source.currentVersionId = version.id;
    source.state = "review_required";
    source.lastConfirmedAt = version.recordedAt;
    const impacts = this.#markDependentsForReview(state, source.id);
    return { source, version, impacts };
  }

  changeSourceState(
    state: WorkspaceEvidenceState,
    input: { sourceId: string; actor: EvidenceActor; state: string; reason?: string },
  ) {
    assertMutable(state);
    actorCanReview(input.actor);
    const source = requireEntity(state.sources.get(input.sourceId));
    if (!["superseded", "revoked", "invalid", "unavailable"].includes(input.state))
      throw new ProblemError("invalid_request");
    source.state = input.state;
    const impacts = this.#markDependentsForReview(state, source.id);
    return {
      source,
      impacts,
      affectedConclusionIds: [...new Set(impacts.map((impact) => impact.conclusionId))],
      notificationCount: 1,
    };
  }

  evaluateDueSources(state: WorkspaceEvidenceState, input: { now: string; actor: EvidenceActor }) {
    void input.actor;
    const affected = new Set<string>();
    let notificationCount = 0;
    for (const source of state.sources.values()) {
      if (source.reviewDueAt === undefined || source.state !== "active") continue;
      if (Date.parse(source.reviewDueAt) <= Date.parse(input.now)) {
        source.state = "review_required";
        const impacts = this.#markDependentsForReview(state, source.id);
        for (const impact of impacts) affected.add(impact.conclusionId);
        notificationCount += 1;
      }
    }
    return { affectedConclusionIds: [...affected], notificationCount };
  }

  getSourceVersion(state: WorkspaceEvidenceState, sourceVersionId: string) {
    return requireEntity(state.sourceVersions.get(sourceVersionId));
  }

  #markDependentsForReview(state: WorkspaceEvidenceState, sourceId: string) {
    const versionIds = new Set(
      [...state.sourceVersions.values()]
        .filter((version) => version.sourceId === sourceId)
        .map((version) => version.id),
    );
    const conclusionIds = new Set(
      state.links
        .filter((link) => versionIds.has(link.sourceVersionId))
        .map((link) => link.conclusionId),
    );
    const now = this.#now().toISOString();
    const touched: any[] = [];
    for (const conclusionId of conclusionIds) {
      const conclusion = state.conclusions.get(conclusionId);
      if (conclusion !== undefined && conclusion.state !== "invalid")
        conclusion.state = "review_required";
      for (const target of [
        { targetType: "conclusion", targetId: conclusionId },
        ...state.impacts.filter(
          (impact) => impact.conclusionId === conclusionId && impact.targetType !== "conclusion",
        ),
      ]) {
        const existing = state.impacts.find(
          (impact) =>
            impact.conclusionId === conclusionId &&
            impact.targetType === target.targetType &&
            impact.targetId === target.targetId &&
            impact.impactKind === "source_changed",
        );
        if (existing === undefined) {
          const impact = {
            id: this.#newId(),
            conclusionId,
            targetType: target.targetType,
            targetId: target.targetId,
            impactKind: "source_changed",
            state: "review_required",
            recordedAt: now,
          };
          state.impacts.push(impact);
          touched.push(impact);
        } else {
          existing.state = "review_required";
          touched.push(existing);
        }
      }
    }
    state.notificationCountBySource[sourceId] =
      (state.notificationCountBySource[sourceId] ?? 0) + 1;
    return touched;
  }
}
