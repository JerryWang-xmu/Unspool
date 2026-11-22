import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import type {
  CreateTeamInput,
  InviteTeamMemberInput,
  TeamService,
  UpdateTeamInput,
  UpdateTeamMembershipInput,
} from "./service.js";

export interface TeamRouteOptions {
  readonly service: TeamService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type TeamParams = { teamId: string };
type MembershipParams = { teamId: string; membershipId: string };

async function actor(options: TeamRouteOptions, request: FastifyRequest): Promise<string> {
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
      detail: "If-Match must contain a team revision.",
    });
  }
  return revision;
}

export function registerTeamRoutes(app: FastifyInstance, options: TeamRouteOptions): void {
  app.get("/v1/teams", async (request) => options.service.listTeams(await actor(options, request)));

  app.post<{ Body: CreateTeamInput }>("/v1/teams", async (request, reply) => {
    const result = await options.service.createTeam(
      await actor(options, request),
      request.body,
      commandId(request),
    );
    return reply.code(result.replayed ? 200 : 201).send(result.response);
  });

  app.patch<{ Params: TeamParams; Body: UpdateTeamInput }>(
    "/v1/teams/:teamId",
    async (request) =>
      (
        await options.service.updateTeam(
          await actor(options, request),
          request.params.teamId,
          request.body,
          commandId(request),
          expectedRevision(request),
        )
      ).response,
  );

  app.get<{ Params: TeamParams }>("/v1/teams/:teamId/members", async (request) =>
    options.service.listMembers(await actor(options, request), request.params.teamId),
  );

  app.post<{ Params: TeamParams; Body: InviteTeamMemberInput }>(
    "/v1/teams/:teamId/members",
    async (request, reply) => {
      const result = await options.service.inviteMember(
        await actor(options, request),
        request.params.teamId,
        request.body,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );

  app.patch<{ Params: MembershipParams; Body: UpdateTeamMembershipInput }>(
    "/v1/teams/:teamId/members/:membershipId",
    async (request) =>
      (
        await options.service.updateMembership(
          await actor(options, request),
          request.params.teamId,
          request.params.membershipId,
          request.body,
          commandId(request),
          expectedRevision(request),
        )
      ).response,
  );
}
