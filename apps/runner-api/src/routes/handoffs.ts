import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import type { AnswerService, PrivateQuestionInput } from "../handoffs/answer-service.js";
import type { BackgroundService, UnresolvedIssueInput } from "../handoffs/background-service.js";
import type { PreparationService } from "../handoffs/preparation-service.js";
import type { PublicationInput, PublicationService } from "../handoffs/publication-service.js";
import type {
  HandoffCommandInput,
  HandoffService,
  InviteHandoffInput,
} from "../handoffs/service.js";
import type { TakeoverInput, TakeoverService } from "../handoffs/takeover-service.js";
import { parseIfMatchRevision } from "../workspaces/service.js";

export interface HandoffRouteOptions {
  readonly handoffs: HandoffService;
  readonly takeover: TakeoverService;
  readonly preparation: PreparationService;
  readonly answers: AnswerService;
  readonly background: BackgroundService;
  readonly publications: PublicationService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type WorkspaceParams = { workspaceId: string };
type HandoffParams = WorkspaceParams & { handoffId: string };

async function actor(options: HandoffRouteOptions, request: FastifyRequest): Promise<string> {
  const actorId = await options.resolveActorId(request);
  if (actorId === null || actorId.trim().length === 0) throw new ProblemError("unauthenticated");
  return actorId;
}

function commandId(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ProblemError("invalid_request", { detail: "Idempotency-Key is required." });
  return value;
}

export function registerHandoffRoutes(app: FastifyInstance, options: HandoffRouteOptions): void {
  app.post<{ Params: WorkspaceParams; Body: InviteHandoffInput }>(
    "/v1/workspaces/:workspaceId/handoffs",
    async (request, reply) => {
      const result = await options.handoffs.invite(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(201).send(result.response);
    },
  );
  app.post<{ Params: HandoffParams; Body: HandoffCommandInput }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/prepare",
    async (request, reply) => {
      const result = await options.preparation.prepare(
        await actor(options, request),
        request.params.workspaceId,
        request.params.handoffId,
        request.body.payloadDigest,
        commandId(request),
      );
      return reply.code(201).send(result.response);
    },
  );
  app.get<{ Params: HandoffParams }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/preparation",
    async (request) =>
      options.preparation.getPreparation(
        await actor(options, request),
        request.params.workspaceId,
        request.params.handoffId,
      ),
  );
  app.post<{ Params: HandoffParams; Body: HandoffCommandInput }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/refresh",
    async (request) =>
      (
        await options.background.refresh(
          await actor(options, request),
          request.params.workspaceId,
          request.params.handoffId,
          request.body.payloadDigest,
          commandId(request),
        )
      ).response,
  );
  app.post<{ Params: HandoffParams; Body: PrivateQuestionInput }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/questions",
    async (request) =>
      (
        await options.answers.ask(
          await actor(options, request),
          request.params.workspaceId,
          request.params.handoffId,
          request.body,
          commandId(request),
        )
      ).response,
  );
  app.post<{ Params: HandoffParams; Body: UnresolvedIssueInput }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/unresolved-issues",
    async (request, reply) => {
      const result = await options.background.recordUnresolvedIssue(
        await actor(options, request),
        request.params.workspaceId,
        request.params.handoffId,
        request.body,
        commandId(request),
      );
      return reply.code(201).send(result.response);
    },
  );
  app.post<{ Params: HandoffParams; Body: PublicationInput }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/publications",
    async (request, reply) => {
      const result = await options.publications.publish(
        await actor(options, request),
        request.params.workspaceId,
        request.params.handoffId,
        request.body,
        commandId(request),
      );
      return reply.code(201).send(result.response);
    },
  );
  app.post<{ Params: HandoffParams; Body: HandoffCommandInput }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/accept",
    async (request) =>
      (
        await options.handoffs.accept(
          await actor(options, request),
          request.params.workspaceId,
          request.params.handoffId,
          request.body,
          commandId(request),
          parseIfMatchRevision(request.headers["if-match"]),
        )
      ).response,
  );
  app.post<{ Params: HandoffParams; Body: HandoffCommandInput & { reason: string } }>(
    "/v1/workspaces/:workspaceId/handoffs/:handoffId/reject",
    async (request) =>
      (
        await options.handoffs.reject(
          await actor(options, request),
          request.params.workspaceId,
          request.params.handoffId,
          request.body,
          commandId(request),
        )
      ).response,
  );
  app.post<{ Params: WorkspaceParams; Body: TakeoverInput }>(
    "/v1/workspaces/:workspaceId/operator-takeover",
    async (request) =>
      (
        await options.takeover.takeover(
          await actor(options, request),
          request.params.workspaceId,
          request.body,
          commandId(request),
          parseIfMatchRevision(request.headers["if-match"]),
        )
      ).response,
  );
}
