import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ArchiveService } from "../archive/service.js";
import { ProblemError } from "../errors/problem.js";
import type { EvidenceRegistry } from "../evidence/registry.js";

export interface ArchiveRouteOptions {
  readonly registry: EvidenceRegistry;
  readonly archive: ArchiveService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

async function context(options: ArchiveRouteOptions, request: FastifyRequest, workspaceId: string) {
  const actorId = await options.resolveActorId(request);
  if (actorId === null) throw new ProblemError("unauthenticated");
  const actor = await options.registry.actor(actorId, workspaceId);
  return { actor, state: options.registry.get(workspaceId) };
}

function commandId(request: FastifyRequest): void {
  if (typeof request.headers["idempotency-key"] !== "string")
    throw new ProblemError("invalid_request", { detail: "Idempotency-Key is required." });
}

export function registerArchiveRoutes(app: FastifyInstance, options: ArchiveRouteOptions): void {
  // Workspace archival is owned by the SQLite collaboration route. This module
  // only exports and reads evidence archives; it must not register a second
  // conflicting archive command with a different in-memory state authority.
  app.post<{ Params: { workspaceId: string }; Body: Record<string, unknown> }>(
    "/v1/workspaces/:workspaceId/archive-exports",
    async (request, reply) => {
      commandId(request);
      const { actor, state } = await context(options, request, request.params.workspaceId);
      return reply
        .code(201)
        .send(options.archive.exportArchive(state, { ...(request.body as any), actor }));
    },
  );
  app.get<{ Params: { workspaceId: string; exportId: string } }>(
    "/v1/workspaces/:workspaceId/archive-exports/:exportId",
    async (request, reply) => {
      const { state } = await context(options, request, request.params.workspaceId);
      const result = options.archive.getArchiveManifest(state, request.params.exportId);
      return reply.type(result.mediaType).send(Buffer.from(result.bytes));
    },
  );
  app.get<{ Params: { workspaceId: string; exportId: string } }>(
    "/v1/workspaces/:workspaceId/archive-exports/:exportId/manifest",
    async (request) => {
      const { state } = await context(options, request, request.params.workspaceId);
      return options.archive.getArchiveManifest(state, request.params.exportId).manifest;
    },
  );
  app.get<{ Params: { workspaceId: string; artifactId: string } }>(
    "/v1/workspaces/:workspaceId/archive-artifacts/:artifactId/content",
    async (request, reply) => {
      const { state } = await context(options, request, request.params.workspaceId);
      const result = options.archive.getArtifactBytes(state, request.params.artifactId);
      return reply.type("application/octet-stream").send(Buffer.from(result.bytes));
    },
  );
  app.get<{ Params: { workspaceId: string }; Querystring: { q?: string } }>(
    "/v1/workspaces/:workspaceId/archive-search",
    async (request) => {
      const { state } = await context(options, request, request.params.workspaceId);
      return options.archive.searchArchive(state, request.query.q ?? "");
    },
  );
  app.get<{ Params: { workspaceId: string } }>(
    "/v1/workspaces/:workspaceId/archive-exports",
    async (request) => {
      const { state } = await context(options, request, request.params.workspaceId);
      return { items: options.archive.getExportAudit(state) };
    },
  );
}
