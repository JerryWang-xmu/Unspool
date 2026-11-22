import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import type { RunCommandInput, RunsService } from "../runs/service.js";

export interface RunsRouteOptions {
  readonly service: RunsService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type RunParams = { workspaceId: string; runId: string };
type WorkspaceParams = { workspaceId: string };
type QueueActionBody = {
  queuedInstructionId: string;
  action: string;
  editedBody?: string;
  operatorEpoch: number;
  payloadDigest: string;
};
type AssessmentBody = {
  result: string;
  reason?: string;
  evidenceExceptionReason?: string;
  payloadDigest: string;
};

async function actor(options: RunsRouteOptions, request: FastifyRequest): Promise<string> {
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

export function registerRunsRoutes(app: FastifyInstance, options: RunsRouteOptions): void {
  app.post<{ Params: WorkspaceParams; Body: RunCommandInput }>(
    "/v1/workspaces/:workspaceId/runs",
    async (request, reply) => {
      const result = await options.service.startRun(
        await actor(options, request),
        request.params.workspaceId,
        request.body,
        commandId(request),
      );
      return reply.code(202).send({ ...result.response.run, ...result.response });
    },
  );

  app.get<{ Params: WorkspaceParams }>("/v1/workspaces/:workspaceId/runs", async (request) => {
    const result = await options.service.listRuns(
      await actor(options, request),
      request.params.workspaceId,
    );
    return { ...result, items: result.runs };
  });

  app.get<{ Params: RunParams }>("/v1/workspaces/:workspaceId/runs/:runId", async (request) => {
    const result = await options.service.getRun(
      await actor(options, request),
      request.params.workspaceId,
      request.params.runId,
    );
    return { ...result.run, ...result };
  });

  app.post<{ Params: RunParams; Body: RunCommandInput }>(
    "/v1/workspaces/:workspaceId/runs/:runId/steer",
    async (request, reply) => {
      const result = await options.service.enqueue(
        await actor(options, request),
        request.params.workspaceId,
        request.params.runId,
        "steer",
        request.body,
        commandId(request),
      );
      return reply.code(202).send(result.response);
    },
  );

  app.post<{ Params: RunParams; Body: RunCommandInput }>(
    "/v1/workspaces/:workspaceId/runs/:runId/follow-ups",
    async (request, reply) => {
      const result = await options.service.enqueue(
        await actor(options, request),
        request.params.workspaceId,
        request.params.runId,
        "follow_up",
        request.body,
        commandId(request),
      );
      return reply.code(202).send(result.response);
    },
  );

  app.post<{ Params: RunParams; Body: RunCommandInput }>(
    "/v1/workspaces/:workspaceId/runs/:runId/stop",
    async (request, reply) => {
      const result = await options.service.stop(
        await actor(options, request),
        request.params.workspaceId,
        request.params.runId,
        request.body,
        commandId(request),
      );
      return reply.code(202).send(result.response);
    },
  );

  app.post<{ Params: RunParams; Body: QueueActionBody }>(
    "/v1/workspaces/:workspaceId/runs/:runId/queue-actions",
    async (request) =>
      options.service.queueAction(
        await actor(options, request),
        request.params.workspaceId,
        request.params.runId,
        request.body,
        commandId(request),
      ),
  );

  app.post<{ Params: RunParams; Body: AssessmentBody }>(
    "/v1/workspaces/:workspaceId/runs/:runId/result",
    async (request) =>
      options.service.assessResult(
        await actor(options, request),
        request.params.workspaceId,
        request.params.runId,
        request.body,
        commandId(request),
      ),
  );
}
