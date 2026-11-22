import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import type { PersonalService, PersonalTaskInput } from "../personal/service.js";

export interface PersonalRouteOptions {
  readonly service: PersonalService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type TaskBody = PersonalTaskInput & { payloadDigest: string };

async function actor(options: PersonalRouteOptions, request: FastifyRequest): Promise<string> {
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

export function registerPersonalRoutes(app: FastifyInstance, options: PersonalRouteOptions): void {
  app.post<{ Body: TaskBody }>("/v1/personal-tasks", async (request, reply) => {
    const result = await options.service.createTask(
      await actor(options, request),
      request.body,
      commandId(request),
    );
    return reply.code(result.replayed ? 200 : 201).send(result.response);
  });

  app.get<{ Querystring: { search?: string; includeArchived?: string } }>(
    "/v1/personal-tasks",
    async (request) =>
      options.service.listTasks(await actor(options, request), {
        ...(request.query.search === undefined ? {} : { search: request.query.search }),
        includeArchived: request.query.includeArchived === "true",
      }),
  );

  const getTask = async (request: FastifyRequest<{ Params: { workspaceId: string } }>) =>
    options.service.getTask(await actor(options, request), request.params.workspaceId);
  app.get<{ Params: { workspaceId: string } }>("/v1/personal-tasks/:workspaceId", getTask);

  app.post<{ Params: { workspaceId: string }; Body: { payloadDigest: string } }>(
    "/v1/personal-tasks/:workspaceId/reopen",
    async (request) => {
      commandId(request);
      return options.service.setArchived(
        await actor(options, request),
        request.params.workspaceId,
        false,
      );
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: { pinned: boolean } }>(
    "/v1/personal-tasks/:workspaceId/pin",
    async (request) => {
      commandId(request);
      if (typeof request.body.pinned !== "boolean") throw new ProblemError("invalid_request");
      return options.service.setPinned(
        await actor(options, request),
        request.params.workspaceId,
        request.body.pinned,
      );
    },
  );
}
