import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { CURRENT_SCHEMA_VERSION } from "../../../packages/persistence/src/migrations.js";
import type {
  B0Grant,
  B0OperationTicket,
} from "../../../packages/test-support/src/federation/fixtures.js";
import { createSqliteApprovalStore } from "./approvals/store.js";
import { ArchiveService } from "./archive/service.js";
import { registerArtifactRoutes } from "./artifacts/routes.js";
import { createArtifactService } from "./artifacts/service.js";
import type { BearerIdentity } from "./auth/bearer.js";
import {
  createBearerAuthenticator,
  derivedLocalId,
  registerBearerAuthentication,
} from "./auth/bearer.js";
import { InputService } from "./collaboration/input-service.js";
import { loadEnvironment } from "./config/environment.js";
import { ContextService } from "./context/service.js";
import { ProblemError, sendProblem } from "./errors/problem.js";
import { CompletionGate } from "./evidence/completion-gate.js";
import { ConclusionService } from "./evidence/conclusion-service.js";
import { ImpactService } from "./evidence/impact-service.js";
import { EvidenceRegistry } from "./evidence/registry.js";
import { SourceService } from "./evidence/source-service.js";
import type { FederationLevel } from "./federation/gates.js";
import { FederationRuntime } from "./federation/runtime.js";
import { AnswerService } from "./handoffs/answer-service.js";
import { BackgroundService } from "./handoffs/background-service.js";
import { PreparationService } from "./handoffs/preparation-service.js";
import { PublicationService } from "./handoffs/publication-service.js";
import { HandoffService } from "./handoffs/service.js";
import { TakeoverService } from "./handoffs/takeover-service.js";
import { openPersonalService } from "./personal/service.js";
import type { StoredApproval } from "./routes/approvals.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerArchiveRoutes } from "./routes/archive.js";
import { registerCollaborationRoutes } from "./routes/collaboration.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerFederationRoutes } from "./routes/federation.js";
import { registerHandoffRoutes } from "./routes/handoffs.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPersonalRoutes } from "./routes/personal.js";
import { registerRunsRoutes } from "./routes/runs.js";
import { registerRunnerRoutes } from "./runners/routes.js";
import { RunnerService } from "./runners/service.js";
import { RunsService } from "./runs/service.js";
import { createSharingService } from "./sharing/service.js";
import { registerTeamRoutes } from "./teams/routes.js";
import { TeamService } from "./teams/service.js";
import { WorkspacesService } from "./workspaces/service.js";

export interface BuildServerOptions {
  readonly dataDir?: string;
  readonly ownerToken?: string;
  readonly logger?: boolean;
  readonly additionalTokens?: Readonly<Record<string, BearerIdentity>>;
  readonly now?: () => Date;
  readonly onAdvanceTime?: (milliseconds: number) => void;
  readonly federationLevel?: FederationLevel;
  readonly onApproved?: (record: StoredApproval) => void | Promise<void>;
  readonly verifyFederationGrant?: (grant: B0Grant) => boolean;
  readonly verifyFederationTicket?: (ticket: B0OperationTicket) => boolean;
  readonly federationValidation?: boolean;
  readonly federationResourceRoots?: Readonly<Record<string, string>>;
  readonly host?: string;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const ownerToken =
    options.ownerToken ?? process.env.UNSPOOL_OWNER_TOKEN ?? process.env.UNSPOOL_US1_OWNER_TOKEN;
  if (ownerToken === undefined || ownerToken.trim().length === 0) {
    if (process.env.NODE_ENV === "production")
      throw new Error("UNSPOOL_OWNER_TOKEN is required in production");
  }
  const effectiveToken = ownerToken ?? "unspool-local-validation-token";
  const dataDir = options.dataDir ?? process.env.UNSPOOL_DATA_DIR ?? ".tmp/runner";
  if (options.federationLevel !== undefined && options.federationValidation !== true) {
    throw new Error("Federation endpoints require an explicit local validation profile");
  }
  if (
    options.federationValidation === true &&
    !["127.0.0.1", "localhost", "::1"].includes(options.host ?? "127.0.0.1")
  ) {
    throw new Error("Federation validation is restricted to loopback");
  }
  const runnerId = derivedLocalId("runner", effectiveToken);
  const agentProfileId = derivedLocalId("model-profile", effectiveToken);
  const {
    service: personalService,
    database,
    close,
  } = await openPersonalService({
    dataDir,
    runnerId,
    agentProfileId,
  });
  const workspacesService = new WorkspacesService({ database });
  const contextService = new ContextService({ database });
  const inputService = new InputService({ database });
  const sharingService = createSharingService({ database });
  const runsService = new RunsService({
    database,
    workspaces: workspacesService,
    context: contextService,
  });
  const artifactService = createArtifactService({ database, dataDir });
  const teamService = new TeamService({ database });
  const runnerService = new RunnerService({ database });
  const timeOptions = options.now === undefined ? {} : { now: options.now };
  const handoffService = new HandoffService({ database, ...timeOptions });
  const takeoverService = new TakeoverService({ database, ...timeOptions });
  const preparationService = new PreparationService({ database, ...timeOptions });
  const answerService = new AnswerService({
    database,
    preparation: preparationService,
    ...timeOptions,
  });
  const backgroundService = new BackgroundService({
    database,
    preparation: preparationService,
    ...timeOptions,
  });
  const publicationService = new PublicationService({
    database,
    preparation: preparationService,
    ...timeOptions,
  });
  const conclusionService = new ConclusionService({ database });
  const evidenceRegistry = new EvidenceRegistry(database, dataDir);
  const sourceService = new SourceService();
  const impactService = new ImpactService();
  const completionGate = new CompletionGate();
  const archiveService = new ArchiveService();
  const federationRuntime = new FederationRuntime(options.federationLevel, {
    databaseFilename: join(dataDir, "unspool.sqlite"),
    keysDirectory: join(dataDir, "keys"),
    ...(options.federationResourceRoots === undefined
      ? {}
      : { resourceRoots: options.federationResourceRoots }),
    ...(options.verifyFederationGrant === undefined
      ? {}
      : { verifyGrantSignature: options.verifyFederationGrant }),
    ...(options.verifyFederationTicket === undefined
      ? {}
      : { verifyTicketSignature: options.verifyFederationTicket }),
  });
  const authenticator = createBearerAuthenticator({
    token: effectiveToken,
    ...(options.additionalTokens === undefined
      ? {}
      : { additionalTokens: options.additionalTokens }),
  });
  const approvalStore = createSqliteApprovalStore(database);
  const server = Fastify({
    logger: options.logger ?? false,
  }).withTypeProvider<TypeBoxTypeProvider>();
  server.addHook("onSend", async (request, reply, payload) => {
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      /^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|tauri:\/\/localhost|http:\/\/tauri\.localhost)$/.test(
        origin,
      )
    ) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    return payload;
  });
  server.options("/v1/*", async (request, reply) => {
    const origin = request.headers.origin;
    if (
      origin === undefined ||
      !/^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|tauri:\/\/localhost|http:\/\/tauri\.localhost)$/.test(
        origin,
      )
    )
      throw new ProblemError("permission_denied");
    return reply
      .header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
      .header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Idempotency-Key, If-Match, Last-Event-ID",
      )
      .header("Access-Control-Max-Age", "600")
      .code(204)
      .send();
  });

  registerBearerAuthentication(server, authenticator);
  server.addHook("onRequest", async (request) => {
    const actorId = authenticator.actorId(request);
    if (actorId === null || !request.url.startsWith("/v1/")) return;
    if (request.url !== "/v1/me" && !/^\/v1\/workspaces\/[^/]+\/events(?:\?|$)/.test(request.url))
      return;
    const now = options.now?.().toISOString() ?? new Date().toISOString();
    await database.execute(
      "INSERT OR IGNORE INTO user (id, display_name, status, auth_version, created_at) VALUES (?, ?, 'active', 1, ?)",
      [actorId, "Authenticated User", now],
    );
    await database.execute(
      `INSERT INTO workspace_presence (workspace_id, user_id, last_seen_at)
       SELECT workspace_id, ?, ? FROM workspace_control WHERE operator_id = ?
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [actorId, now, actorId],
    );
  });
  registerHealthRoutes(server, { capabilities: { schemaVersion: CURRENT_SCHEMA_VERSION } });
  registerDiscoveryRoutes(server, { authenticator, ownerToken: effectiveToken, runnerService });
  registerPersonalRoutes(server, {
    service: personalService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerRunsRoutes(server, {
    service: runsService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerArtifactRoutes(server, {
    service: artifactService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerApprovalRoutes(server, {
    store: approvalStore,
    resolveActorId: (request) => authenticator.actorId(request),
    ...(options.onApproved === undefined ? {} : { onApproved: options.onApproved }),
  });
  registerTeamRoutes(server, {
    service: teamService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerRunnerRoutes(server, {
    service: runnerService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerCollaborationRoutes(server, {
    workspaces: workspacesService,
    context: contextService,
    input: inputService,
    sharing: sharingService,
    onArchived: (workspaceId) => {
      // The persistent collaboration command already authorized and committed
      // archival; project the same terminal state into the evidence read model.
      evidenceRegistry.get(workspaceId).status = "archived";
    },
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerEventRoutes(server, {
    database,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerEvidenceRoutes(server, {
    registry: evidenceRegistry,
    conclusions: conclusionService,
    sources: sourceService,
    impacts: impactService,
    completion: completionGate,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerArchiveRoutes(server, {
    registry: evidenceRegistry,
    archive: archiveService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerFederationRoutes(server, {
    runtime: federationRuntime,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  registerHandoffRoutes(server, {
    handoffs: handoffService,
    takeover: takeoverService,
    preparation: preparationService,
    answers: answerService,
    background: backgroundService,
    publications: publicationService,
    resolveActorId: (request) => authenticator.actorId(request),
  });
  if (options.onAdvanceTime !== undefined) {
    const advance = options.onAdvanceTime;
    server.post<{ Body: { advanceMs?: number } }>("/v1/validation/clock", async (request) => {
      const milliseconds = request.body.advanceMs;
      if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds))
        throw new ProblemError("invalid_request");
      advance(milliseconds);
      return { now: options.now?.().toISOString() };
    });
  }

  server.setNotFoundHandler((_request, reply) => sendProblem(reply, "not_found"));
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProblemError) return sendProblem(reply, error.problem);
    return sendProblem(reply, "internal_error");
  });
  server.addHook("onClose", async () => {
    federationRuntime.close();
    await close();
  });
  return server;
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  const server = await buildServer({
    dataDir: environment.UNSPOOL_DATA_DIR,
    logger: true,
    host: environment.HOST,
    federationValidation: process.env.UNSPOOL_FEDERATION_VALIDATION === "1",
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, "shutting down Runner API");
    await server.close();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      shutdown(signal).catch((error: unknown) => {
        server.log.error(error, "Runner API shutdown failed");
        process.exitCode = 1;
      });
    });
  }

  await server.listen({ host: environment.HOST, port: environment.PORT });
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
