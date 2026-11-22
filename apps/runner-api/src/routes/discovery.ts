import type { FastifyInstance } from "fastify";
import type { BearerAuthenticator } from "../auth/bearer.js";
import { derivedLocalId } from "../auth/bearer.js";
import { sendProblem } from "../errors/problem.js";
import type { RunnerService } from "../runners/service.js";

export interface DiscoveryRouteOptions {
  readonly authenticator: BearerAuthenticator;
  readonly ownerToken: string;
  readonly runnerService?: RunnerService | undefined;
}

export function registerDiscoveryRoutes(
  app: FastifyInstance,
  options: DiscoveryRouteOptions,
): void {
  const localRunnerId = derivedLocalId("runner", options.ownerToken);
  const localProfileId = derivedLocalId("model-profile", options.ownerToken);

  app.get("/v1/me", async (request, reply) => {
    const principal = options.authenticator.identityFor(request);
    if (principal === null) return sendProblem(reply, "unauthenticated");
    return { principal: { ...principal } };
  });

  app.get("/v1/runners", async (request, reply) => {
    const actorId = options.authenticator.actorId(request);
    if (actorId === null) return sendProblem(reply, "unauthenticated");
    const registered =
      options.runnerService === undefined
        ? { runners: [] }
        : await options.runnerService.listVisibleRunners(actorId);
    const runners = [
      {
        id: localRunnerId,
        name: "Local Runner",
        purpose: "personal",
        status: "available",
        version: "0.1.0",
        stableTrack: "stable",
      },
      ...registered.runners.filter((runner) => runner.id !== localRunnerId),
    ];
    return { runners };
  });

  app.get<{ Params: { runnerId: string } }>(
    "/v1/runners/:runnerId/model-profiles",
    async (request, reply) => {
      const actorId = options.authenticator.actorId(request);
      if (actorId === null) return sendProblem(reply, "unauthenticated");
      if (request.params.runnerId !== localRunnerId) {
        if (options.runnerService === undefined) return sendProblem(reply, "not_found");
        return options.runnerService.listModelProfiles(actorId, request.params.runnerId);
      }
      return {
        modelProfiles: [
          {
            id: localProfileId,
            profileId: localProfileId,
            runnerId: localRunnerId,
            provider: "faux",
            model: "faux-model",
            enabled: true,
            health: "available",
          },
        ],
      };
    },
  );
}
