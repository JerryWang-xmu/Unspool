import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import type {
  ModelProfileUpsertInput,
  RunnerRegistrationInput,
  RunnerService,
  RunnerUpdateInput,
} from "./service.js";

export interface RunnerRouteOptions {
  readonly service: RunnerService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type TeamParams = { teamId: string };
type RunnerParams = { runnerId: string };

async function actor(options: RunnerRouteOptions, request: FastifyRequest): Promise<string> {
  const actorId = await options.resolveActorId(request);
  if (actorId === null || actorId.trim().length === 0) {
    throw new ProblemError("unauthenticated");
  }
  return actorId;
}

function commandId(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProblemError("invalid_request", {
      detail: "Idempotency-Key is required.",
    });
  }
  return value;
}

function expectedRevision(request: FastifyRequest): number | undefined {
  const value = request.headers["if-match"];
  if (value === undefined) {
    return undefined;
  }
  const normalized = String(value).replaceAll('"', "");
  const revision = Number(normalized);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ProblemError("invalid_request", {
      detail: "If-Match must contain a runner revision.",
    });
  }
  return revision;
}

export function registerRunnerRoutes(app: FastifyInstance, options: RunnerRouteOptions): void {
  app.post<{ Params: TeamParams; Body: RunnerRegistrationInput }>(
    "/v1/teams/:teamId/runners",
    async (request, reply) => {
      const result = await options.service.registerRunner(
        await actor(options, request),
        request.params.teamId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );

  app.patch<{ Params: RunnerParams; Body: RunnerUpdateInput }>(
    "/v1/runners/:runnerId",
    async (request) =>
      (
        await options.service.updateRunner(
          await actor(options, request),
          request.params.runnerId,
          request.body,
          commandId(request),
          expectedRevision(request),
        )
      ).response,
  );

  app.post<{ Params: RunnerParams; Body: ModelProfileUpsertInput }>(
    "/v1/runners/:runnerId/model-profiles",
    async (request, reply) => {
      const result = await options.service.upsertModelProfile(
        await actor(options, request),
        request.params.runnerId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );
}
