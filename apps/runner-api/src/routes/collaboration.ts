import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  DecideSuggestionCommand,
  InputService,
  PostInputCommand,
} from "../collaboration/input-service.js";
import type { ContextService, ContextVersionInput } from "../context/service.js";
import { ProblemError } from "../errors/problem.js";
import type {
  ShareConversionCommandInput,
  SharePreviewCommandInput,
  SharingService,
} from "../sharing/service.js";
import {
  type ActivateWorkspaceInput,
  type ArchiveWorkspaceInput,
  type CreateSharedWorkspaceInput,
  type InviteWorkspaceMembersInput,
  parseIfMatchRevision,
  type SharedWorkspaceView,
  type UpdateWorkspaceInput,
  type WorkspacesService,
} from "../workspaces/service.js";

export interface CollaborationRouteOptions {
  readonly workspaces: WorkspacesService;
  readonly context: ContextService;
  readonly input: InputService;
  readonly sharing: SharingService;
  readonly onArchived?: ((workspaceId: string) => void) | undefined;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type WorkspaceParams = { workspaceId: string };
type ContextParams = WorkspaceParams & { contextItemId: string };
type SuggestionParams = WorkspaceParams & { suggestionId: string };

async function actor(options: CollaborationRouteOptions, request: FastifyRequest): Promise<string> {
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

function revision(request: FastifyRequest): number {
  return parseIfMatchRevision(request.headers["if-match"]);
}

function withWorkspace<T extends { workspace: SharedWorkspaceView }>(value: T) {
  return { ...value.workspace, ...value };
}

export function registerCollaborationRoutes(
  app: FastifyInstance,
  options: CollaborationRouteOptions,
): void {
  app.get("/v1/workspaces", async (request) =>
    options.workspaces.listWorkspaces(await actor(options, request)),
  );
  app.post<{ Body: CreateSharedWorkspaceInput }>("/v1/workspaces", async (request, reply) => {
    const result = await options.workspaces.createSharedWorkspace(
      await actor(options, request),
      request.body,
      commandId(request),
    );
    return reply.code(result.replayed ? 200 : 201).send(withWorkspace(result.response));
  });
  app.get<{ Params: WorkspaceParams }>("/v1/workspaces/:workspaceId", async (request) => {
    const result = await options.workspaces.getWorkspace(
      await actor(options, request),
      request.params.workspaceId,
    );
    return { ...result.workspace, ...result };
  });
  app.patch<{ Params: WorkspaceParams; Body: UpdateWorkspaceInput }>(
    "/v1/workspaces/:workspaceId",
    async (request) =>
      withWorkspace(
        (
          await options.workspaces.updateWorkspace(
            await actor(options, request),
            request.params.workspaceId,
            request.body,
            revision(request),
            commandId(request),
          )
        ).response,
      ),
  );
  app.post<{ Params: WorkspaceParams; Body: ArchiveWorkspaceInput }>(
    "/v1/workspaces/:workspaceId/archive",
    async (request) => {
      const result = await options.workspaces.archiveWorkspace(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        revision(request),
        commandId(request),
      );
      options.onArchived?.(request.params.workspaceId);
      return withWorkspace(result.response);
    },
  );
  app.post<{ Params: WorkspaceParams; Body: ActivateWorkspaceInput }>(
    "/v1/workspaces/:workspaceId/activate",
    async (request) =>
      withWorkspace(
        (
          await options.workspaces.activateWorkspace(
            await actor(options, request),
            request.params.workspaceId,
            request.body,
            revision(request),
            commandId(request),
          )
        ).response,
      ),
  );
  app.post<{ Params: WorkspaceParams; Body: InviteWorkspaceMembersInput }>(
    "/v1/workspaces/:workspaceId/members",
    async (request, reply) => {
      const result = await options.workspaces.inviteWorkspaceMembers(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );

  app.get<{ Params: WorkspaceParams }>(
    "/v1/workspaces/:workspaceId/context-items",
    async (request) => {
      const result = await options.context.listContextItems(
        await actor(options, request),
        request.params.workspaceId,
      );
      return { ...result, items: result.contextItems };
    },
  );
  app.post<{ Params: WorkspaceParams; Body: ContextVersionInput }>(
    "/v1/workspaces/:workspaceId/context-items",
    async (request, reply) => {
      const result = await options.context.createContextItem(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );
  app.get<{ Params: ContextParams }>(
    "/v1/workspaces/:workspaceId/context-items/:contextItemId",
    async (request) =>
      options.context.getContextItem(
        await actor(options, request),
        request.params.workspaceId,
        request.params.contextItemId,
      ),
  );
  app.post<{ Params: ContextParams; Body: ContextVersionInput }>(
    "/v1/workspaces/:workspaceId/context-items/:contextItemId/versions",
    async (request, reply) => {
      const result = await options.context.appendContextVersion(
        await actor(options, request),
        request.params.workspaceId,
        request.params.contextItemId,
        revision(request),
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );
  app.get<{ Params: WorkspaceParams & { runId: string } }>(
    "/v1/workspaces/:workspaceId/runs/:runId/context-snapshot",
    async (request) =>
      options.context.getRunSnapshot(
        await actor(options, request),
        request.params.workspaceId,
        request.params.runId,
      ),
  );

  app.post<{ Params: WorkspaceParams; Body: PostInputCommand }>(
    "/v1/workspaces/:workspaceId/discussions",
    async (request, reply) => {
      const result = await options.input.postDiscussion(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );
  app.post<{ Params: WorkspaceParams; Body: PostInputCommand }>(
    "/v1/workspaces/:workspaceId/suggestions",
    async (request, reply) => {
      const result = await options.input.postSuggestion(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );
  app.get<{ Params: WorkspaceParams }>("/v1/workspaces/:workspaceId/suggestions", async (request) =>
    options.input.listSuggestions(await actor(options, request), request.params.workspaceId),
  );
  app.post<{ Params: SuggestionParams; Body: DecideSuggestionCommand }>(
    "/v1/workspaces/:workspaceId/suggestions/:suggestionId/decision",
    async (request) =>
      (
        await options.input.decideSuggestion(
          await actor(options, request),
          request.params.workspaceId,
          request.params.suggestionId,
          request.body,
          commandId(request),
        )
      ).response,
  );
  app.post<{ Params: WorkspaceParams; Body: PostInputCommand }>(
    "/v1/workspaces/:workspaceId/direct-instructions",
    async (request, reply) => {
      const result = await options.input.postDirectInstruction(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );

  app.post<{ Params: WorkspaceParams; Body: SharePreviewCommandInput }>(
    "/v1/personal-tasks/:workspaceId/share-preview",
    async (request) =>
      (
        await options.sharing.createPreview(
          await actor(options, request),
          request.params.workspaceId,
          request.body,
          commandId(request),
        )
      ).response,
  );
  app.post<{ Params: WorkspaceParams; Body: ShareConversionCommandInput }>(
    "/v1/personal-tasks/:workspaceId/share",
    async (request, reply) => {
      const result = await options.sharing.convert(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );
}
