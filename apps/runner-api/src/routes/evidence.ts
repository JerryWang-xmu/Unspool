import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import type { CompletionGate } from "../evidence/completion-gate.js";
import type { ConclusionService } from "../evidence/conclusion-service.js";
import type { ImpactService } from "../evidence/impact-service.js";
import type { EvidenceRegistry } from "../evidence/registry.js";
import type { SourceService } from "../evidence/source-service.js";

export interface EvidenceRouteOptions {
  readonly registry: EvidenceRegistry;
  readonly conclusions: ConclusionService;
  readonly sources: SourceService;
  readonly impacts: ImpactService;
  readonly completion: CompletionGate;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type WorkspaceParams = { workspaceId: string };
type ConclusionParams = WorkspaceParams & { conclusionId: string };
type SourceParams = WorkspaceParams & { sourceId: string };

async function context(
  options: EvidenceRouteOptions,
  request: FastifyRequest,
  workspaceId: string,
) {
  const actorId = await options.resolveActorId(request);
  if (actorId === null) throw new ProblemError("unauthenticated");
  const actor = await options.registry.actor(actorId, workspaceId);
  return { actor, state: options.registry.get(workspaceId) };
}

function commandId(request: FastifyRequest): void {
  if (typeof request.headers["idempotency-key"] !== "string")
    throw new ProblemError("invalid_request", { detail: "Idempotency-Key is required." });
}

export function registerEvidenceRoutes(app: FastifyInstance, options: EvidenceRouteOptions): void {
  app.get<{ Params: WorkspaceParams }>(
    "/v1/workspaces/:workspaceId/conclusions",
    async (request) => {
      const { state } = await context(options, request, request.params.workspaceId);
      return { items: [...state.conclusions.values()] };
    },
  );
  app.post<{ Params: WorkspaceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/conclusions",
    async (request, reply) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return reply
        .code(201)
        .send(options.conclusions.proposeConclusion(state, { ...(request.body as any), actor }));
    },
  );
  app.post<{ Params: ConclusionParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/conclusions/:conclusionId/review",
    async (request) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return options.conclusions.reviewConclusion(state, {
        ...(request.body as any),
        conclusionId: request.params.conclusionId,
        actor,
      } as any);
    },
  );
  app.get<{ Params: ConclusionParams }>(
    "/v1/workspaces/:workspaceId/conclusions/:conclusionId/reviews",
    async (request) => {
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return {
        items: options.conclusions.getReviewHistory(state, {
          conclusionId: request.params.conclusionId,
          actor,
        }),
      };
    },
  );
  app.post<{ Params: WorkspaceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/evidence-exceptions",
    async (request, reply) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return reply
        .code(201)
        .send(
          options.conclusions.recordEvidenceException(state, { ...(request.body as any), actor }),
        );
    },
  );

  app.post<{ Params: WorkspaceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/sources",
    async (request, reply) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return reply
        .code(201)
        .send(options.sources.addSource(state, { ...(request.body as any), actor }));
    },
  );
  app.post<{ Params: SourceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/sources/:sourceId/versions",
    async (request, reply) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return reply.code(201).send(
        options.sources.recordSourceVersion(state, {
          ...(request.body as any),
          sourceId: request.params.sourceId,
          actor,
        } as any),
      );
    },
  );
  app.get<{ Params: WorkspaceParams & { sourceVersionId: string } }>(
    "/v1/workspaces/:workspaceId/source-versions/:sourceVersionId",
    async (request) => {
      const { state } = await context(options, request, request.params.workspaceId);
      return options.sources.getSourceVersion(state, request.params.sourceVersionId);
    },
  );
  app.post<{ Params: SourceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/sources/:sourceId/state",
    async (request) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return options.sources.changeSourceState(state, {
        ...(request.body as any),
        sourceId: request.params.sourceId,
        actor,
      } as any);
    },
  );
  app.post<{ Params: WorkspaceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/sources/evaluate-due",
    async (request) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return options.sources.evaluateDueSources(state, { ...(request.body as any), actor });
    },
  );
  app.get<{ Params: WorkspaceParams }>("/v1/workspaces/:workspaceId/impact", async (request) => {
    const { state } = await context(options, request, request.params.workspaceId);
    return options.impacts.getImpactView(state);
  });
  app.post<{ Params: WorkspaceParams; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/completion-assessments",
    async (request) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return options.completion.assessCompletion(state, { ...(request.body as any), actor });
    },
  );
  app.get<{ Params: WorkspaceParams & { runId: string } }>(
    "/v1/workspaces/:workspaceId/completion-assessments/:runId",
    async (request) => {
      const { state } = await context(options, request, request.params.workspaceId);
      return options.completion.getCompletionState(state, request.params.runId);
    },
  );
}
