import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProblemError } from "../errors/problem.js";
import { contentDisposition, parseRangeHeader } from "./download.js";
import { MultipartParseError, parseMultipartFormData } from "./multipart.js";
import type { ArtifactMetadataInput, ArtifactService } from "./service.js";

export interface ArtifactRouteOptions {
  readonly service: ArtifactService;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

type WorkspaceParams = { workspaceId: string };
type ArtifactParams = { workspaceId: string; artifactId: string };
type VersionParams = ArtifactParams & { version: string };

async function actor(options: ArtifactRouteOptions, request: FastifyRequest): Promise<string> {
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

function uploadInput(request: FastifyRequest): { metadata: ArtifactMetadataInput; bytes: Buffer } {
  if (!Buffer.isBuffer(request.body))
    throw new ProblemError("invalid_request", { detail: "A multipart artifact body is required." });
  try {
    const form = parseMultipartFormData(request.body, request.headers["content-type"] ?? "");
    const metadataPart = form.fields.get("metadata");
    const contentPart = form.fields.get("content");
    if (metadataPart === undefined || contentPart === undefined || form.fields.size !== 2)
      throw new ProblemError("invalid_request", {
        detail: "Exactly one metadata and one content part are required.",
      });
    const metadata = JSON.parse(metadataPart.data.toString("utf8")) as ArtifactMetadataInput;
    return { metadata, bytes: contentPart.data };
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    if (error instanceof MultipartParseError || error instanceof SyntaxError)
      throw new ProblemError("invalid_request", {
        detail: "Multipart artifact metadata or content is malformed.",
      });
    throw error;
  }
}

function optionalVersion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new ProblemError("invalid_request");
  return version;
}

export function registerArtifactRoutes(app: FastifyInstance, options: ArtifactRouteOptions): void {
  const parser = (
    _request: FastifyRequest,
    body: Buffer,
    done: (error: Error | null, body?: Buffer) => void,
  ) => done(null, body);
  if (!app.hasContentTypeParser("multipart/form-data")) {
    app.addContentTypeParser(
      "multipart/form-data",
      { parseAs: "buffer", bodyLimit: options.service.maxUploadBytes + 1024 * 1024 },
      parser,
    );
  }

  app.post<{ Params: WorkspaceParams }>(
    "/v1/workspaces/:workspaceId/artifacts",
    async (request, reply) => {
      const { metadata, bytes } = uploadInput(request);
      const result = await options.service.upload(
        await actor(options, request),
        request.params.workspaceId,
        metadata,
        bytes,
        commandId(request),
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );

  app.post<{ Params: ArtifactParams }>(
    "/v1/workspaces/:workspaceId/artifacts/:artifactId/versions",
    async (request, reply) => {
      const { metadata, bytes } = uploadInput(request);
      const result = await options.service.upload(
        await actor(options, request),
        request.params.workspaceId,
        metadata,
        bytes,
        commandId(request),
        request.params.artifactId,
      );
      return reply.code(result.replayed ? 200 : 201).send(result.response);
    },
  );

  app.get<{ Params: WorkspaceParams }>("/v1/workspaces/:workspaceId/artifacts", async (request) =>
    options.service.list(await actor(options, request), request.params.workspaceId),
  );

  app.get<{ Params: ArtifactParams }>(
    "/v1/workspaces/:workspaceId/artifacts/:artifactId",
    async (request) => ({
      artifact: await options.service.get(
        await actor(options, request),
        request.params.workspaceId,
        request.params.artifactId,
      ),
    }),
  );

  app.get<{ Params: ArtifactParams }>(
    "/v1/workspaces/:workspaceId/artifacts/:artifactId/preview",
    async (request) =>
      options.service.preview(
        await actor(options, request),
        request.params.workspaceId,
        request.params.artifactId,
      ),
  );

  app.get<{ Params: VersionParams }>(
    "/v1/workspaces/:workspaceId/artifacts/:artifactId/versions/:version",
    async (request) => ({
      artifact: await options.service.get(
        await actor(options, request),
        request.params.workspaceId,
        request.params.artifactId,
        optionalVersion(request.params.version),
      ),
    }),
  );

  const download = async (
    request: FastifyRequest<{ Params: ArtifactParams; Querystring?: { version?: string } }>,
    reply: import("fastify").FastifyReply,
  ) => {
    const version = optionalVersion(request.query?.version);
    const { artifact, bytes } = await options.service.content(
      await actor(options, request),
      request.params.workspaceId,
      request.params.artifactId,
      version,
    );
    const range = parseRangeHeader(request.headers.range, bytes.byteLength);
    reply
      .header("Accept-Ranges", "bytes")
      .header("Content-Disposition", contentDisposition(String(artifact.name)))
      .type("application/octet-stream");
    if (range.kind === "unsatisfiable") {
      reply.header("Content-Range", `bytes */${bytes.byteLength}`);
      return reply.code(416).send(Buffer.alloc(0));
    }
    if (range.kind === "partial") {
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
      return reply.code(206).send(Buffer.from(bytes.subarray(range.start, range.end + 1)));
    }
    return reply.code(200).send(Buffer.from(bytes));
  };
  app.get<{ Params: ArtifactParams; Querystring?: { version?: string } }>(
    "/v1/workspaces/:workspaceId/artifacts/:artifactId/content",
    download,
  );
}

export const registerRoutes = registerArtifactRoutes;
