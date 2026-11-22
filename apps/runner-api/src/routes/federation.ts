import { verify as verifySignature } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  federationDigest,
  stableJson,
} from "../../../../packages/contracts/src/federation-validation.js";
import type {
  B0NodeReceipt,
  B0OperationTicket,
} from "../../../../packages/test-support/src/federation/fixtures.js";
import { ProblemError } from "../errors/problem.js";
import {
  exportFederatedArchive,
  serializeFederatedArchive,
} from "../federation/archive-exporter.js";
import { transferArtifact } from "../federation/artifact-transfer.js";
import { acceptFederatedHandoff, prepareFederatedHandoff } from "../federation/handoff.js";
import { applyPatch, createPatchProposal } from "../federation/patch.js";
import type { FederationRuntime } from "../federation/runtime.js";

export interface FederationRouteOptions {
  readonly runtime: FederationRuntime;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
}

async function actor(options: FederationRouteOptions, request: FastifyRequest): Promise<string> {
  const actorId = await options.resolveActorId(request);
  if (actorId === null) throw new ProblemError("unauthenticated");
  return actorId;
}

function verifyNodeReceipt(
  runtime: FederationRuntime,
  actorId: string,
  input: B0NodeReceipt,
): B0NodeReceipt {
  const node = runtime.pairing.get(input.nodeId);
  if (node.ownerId !== actorId) throw new ProblemError("permission_denied");
  const { nodeSignature, uploadState: _uploadState, ...signed } = input;
  if (
    !verifySignature(
      null,
      Buffer.from(stableJson(signed)),
      node.publicKey,
      Buffer.from(nodeSignature, "base64"),
    )
  )
    throw new ProblemError("permission_denied", { detail: "receipt_signature_invalid" });
  return { ...input, uploadState: "pending" };
}

function operationTicket(request: FastifyRequest): B0OperationTicket {
  const encoded = request.headers["x-unspool-operation-ticket"];
  if (typeof encoded !== "string" || encoded.length === 0)
    throw new ProblemError("permission_denied", { detail: "operation_ticket_required" });
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const required = [
      "requestId",
      "nonce",
      "executionId",
      "nodeId",
      "runId",
      "grantDigest",
      "actionDigest",
      "recipientDigest",
      "bodyDigest",
      "notBefore",
      "expiresAt",
      "signature",
    ];
    if (required.some((key) => typeof value[key] !== "string" || value[key] === ""))
      throw new Error("invalid ticket");
    return value as unknown as B0OperationTicket;
  } catch {
    throw new ProblemError("invalid_request", { detail: "operation_ticket_invalid" });
  }
}

function operationGrant(
  runtime: FederationRuntime,
  grantId: unknown,
  actorId: string,
  operation: string,
  resourceDigest: string,
) {
  if (typeof grantId !== "string" || !runtime.grants.verify(grantId))
    throw new ProblemError("permission_denied");
  const grant = runtime.grants.get(grantId);
  if (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
    throw new ProblemError("permission_denied");
  if (!grant.operations.includes(operation) || grant.resourceDigest !== resourceDigest)
    throw new ProblemError("permission_denied");
  return grant;
}

export function registerFederationRoutes(
  app: FastifyInstance,
  options: FederationRouteOptions,
): void {
  const { runtime } = options;
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/v1/federation/")) return;
    runtime.assertEnabled("snapshot");
    await actor(options, request);
  });
  app.post("/v1/federation/nodes/pair", async (request, reply) => {
    const actorId = await actor(options, request);
    return reply.code(201).send(runtime.pairing.createCode(actorId));
  });
  app.post("/v1/federation/nodes/:nodeId/complete", async (request, reply) => {
    const actorId = await actor(options, request);
    const body = request.body as { code: string };
    if (runtime.pairing.ownerForCode(body.code) !== actorId)
      throw new ProblemError("permission_denied");
    const params = request.params as { nodeId: string };
    return reply.code(201).send(runtime.pairing.complete(params.nodeId, body.code));
  });
  app.get("/v1/federation/nodes/:nodeId", async (request) => {
    const actorId = await actor(options, request);
    const node = runtime.pairing.get((request.params as { nodeId: string }).nodeId);
    if (node.ownerId !== actorId) throw new ProblemError("permission_denied");
    return node;
  });
  app.post("/v1/federation/nodes/:nodeId/rotate", async (request) => {
    const actorId = await actor(options, request);
    const nodeId = (request.params as { nodeId: string }).nodeId;
    if (runtime.pairing.get(nodeId).ownerId !== actorId)
      throw new ProblemError("permission_denied");
    return runtime.pairing.rotate(nodeId);
  });

  app.post("/v1/federation/grants", async (request, reply) => {
    runtime.assertEnabled("snapshot");
    const actorId = await actor(options, request);
    const body = request.body as any;
    runtime.grants.registerOwner(actorId);
    return reply.code(201).send(runtime.grants.propose({ ...body, ownerId: actorId }));
  });
  app.post("/v1/federation/grants/:grantId/decision", async (request) => {
    runtime.assertEnabled("snapshot");
    const actorId = await actor(options, request);
    const grantId = (request.params as { grantId: string }).grantId;
    if (runtime.grants.get(grantId).ownerId !== actorId)
      throw new ProblemError("permission_denied");
    const body = request.body as any;
    return runtime.grants.decide(grantId, body.decision, body.reduction);
  });
  app.get("/v1/federation/grants/:grantId", async (request) => {
    const actorId = await actor(options, request);
    const grant = runtime.grants.get((request.params as { grantId: string }).grantId);
    if (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
      throw new ProblemError("permission_denied");
    return grant;
  });
  app.post("/v1/federation/tickets/accept", async (request) => {
    const actorId = await actor(options, request);
    const body = request.body as any;
    const grant = runtime.grants.get(body.grantId ?? body.grant?.id);
    if (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
      throw new ProblemError("permission_denied");
    if (typeof body.operation !== "string" || !grant.operations.includes(body.operation))
      throw new ProblemError("permission_denied");
    const bodyDigest = federationDigest(body.payload);
    const actionDigest = federationDigest({ operation: body.operation, bodyDigest });
    const recipientDigest = federationDigest({ recipientId: actorId });
    return runtime.tickets.accept(
      runtime.ticketInput({ ...body, grant, bodyDigest, actionDigest, recipientDigest }) as any,
    );
  });

  app.post("/v1/federation/resources/register", async (request, reply) => {
    const actorId = await actor(options, request);
    const body = request.body as { resourceId: string };
    runtime.resourceRoot(actorId, body.resourceId);
    return reply.code(201).send({ resourceId: body.resourceId, ownerId: actorId });
  });

  app.post("/v1/federation/snapshots", async (request, reply) => {
    runtime.assertEnabled("snapshot");
    const actorId = await actor(options, request);
    const body = request.body as any;
    const manifest = await runtime.snapshots.create({
      ...body,
      root: runtime.resourceRoot(actorId, body.resourceId),
    });
    runtime.recordManifest(manifest, actorId);
    return reply.code(201).send(manifest);
  });
  app.get("/v1/federation/snapshots/:snapshotId/entries/:entryId", async (request) => {
    runtime.assertEnabled("snapshot");
    const actorId = await actor(options, request);
    const grantId = (request.query as { grantId?: string }).grantId;
    if (grantId === undefined || !runtime.grants.verify(grantId))
      throw new ProblemError("permission_denied");
    const grant = runtime.grants.get(grantId);
    if (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
      throw new ProblemError("permission_denied");
    if (!grant.operations.includes("snapshot.read")) throw new ProblemError("permission_denied");
    const params = request.params as { snapshotId: string; entryId: string };
    const manifest = runtime.manifests.get(params.snapshotId);
    if (manifest === undefined) throw new ProblemError("not_found");
    if (
      manifest.resourceId !== grant.resourceId ||
      manifest.rootDigest !== grant.resourceDigest ||
      runtime.manifestOwner(manifest.id) !== grant.ownerId
    )
      throw new ProblemError("permission_denied");
    const cachePolicy = (grant as unknown as { cachePolicy?: { centralCache?: boolean } })
      .cachePolicy;
    if (cachePolicy?.centralCache !== true)
      throw new ProblemError("permission_denied", { detail: "central_cache_denied" });
    const payload = { snapshotId: params.snapshotId, entryId: params.entryId };
    const bodyDigest = federationDigest(payload);
    const actionDigest = federationDigest({ operation: "snapshot.read", bodyDigest });
    const lease = runtime.tickets.accept(
      runtime.ticketInput({
        ticket: operationTicket(request),
        grant,
        bodyDigest,
        actionDigest,
        recipientDigest: federationDigest({ recipientId: actorId }),
      }) as any,
    );
    const result = runtime.snapshots.readCentral(manifest, params.entryId);
    return { ...result, bytes: Buffer.from(result.bytes).toString("base64"), operation: lease };
  });

  app.post("/v1/federation/receipts", async (request) => {
    const actorId = await actor(options, request);
    return runtime.receipts.append(
      verifyNodeReceipt(runtime, actorId, request.body as B0NodeReceipt),
    );
  });
  app.post("/v1/federation/receipts/backfill", async (request) => {
    const actorId = await actor(options, request);
    return runtime.receipts.backfill(
      verifyNodeReceipt(runtime, actorId, request.body as B0NodeReceipt),
    );
  });
  app.get("/v1/federation/receipts", async (request) => {
    const actorId = await actor(options, request);
    const owned = new Set(
      runtime.pairing
        .list()
        .filter((node) => node.ownerId === actorId)
        .map((node) => node.id),
    );
    const nodeId = (request.query as { nodeId?: string }).nodeId;
    if (nodeId !== undefined && !owned.has(nodeId)) throw new ProblemError("permission_denied");
    return { items: runtime.receipts.list(nodeId).filter((receipt) => owned.has(receipt.nodeId)) };
  });
  app.get("/v1/federation/receipt-gaps", async (request) => {
    const actorId = await actor(options, request);
    const owned = new Set(
      runtime.pairing
        .list()
        .filter((node) => node.ownerId === actorId)
        .map((node) => node.id),
    );
    const nodeId = (request.query as { nodeId?: string }).nodeId;
    if (nodeId !== undefined && !owned.has(nodeId)) throw new ProblemError("permission_denied");
    return { items: runtime.receipts.gaps(nodeId).filter((gap) => owned.has(gap.nodeId)) };
  });

  app.post("/v1/federation/tools/register", async (request, reply) => {
    runtime.assertEnabled("snapshot_tools");
    const actorId = await actor(options, request);
    const body = request.body as any;
    const { digest: _ignored, ...canonical } = body;
    if (federationDigest(canonical) !== body.digest)
      throw new ProblemError("invalid_request", { detail: "template_digest_mismatch" });
    if (runtime.pairing.get(body.nodeId).ownerId !== actorId)
      throw new ProblemError("permission_denied");
    return reply.code(201).send(runtime.registerTemplate(actorId, body));
  });
  app.post("/v1/federation/tools/execute", async (request) => {
    runtime.assertEnabled("snapshot_tools");
    const actorId = await actor(options, request);
    const body = request.body as any;
    const template = runtime.tools.get(body.templateId);
    const grant = operationGrant(
      runtime,
      body.grantId,
      actorId,
      "fixed_tool.execute",
      template.digest,
    );
    if (grant.ownerId !== runtime.templateOwner(template.id))
      throw new ProblemError("permission_denied");
    const payload = {
      templateId: template.id,
      templateDigest: template.digest,
      arguments: body.arguments,
    };
    const bodyDigest = federationDigest(payload);
    const actionDigest = federationDigest({ operation: "fixed_tool.execute", bodyDigest });
    runtime.tickets.accept(
      runtime.ticketInput({
        ticket: body.ticket,
        grant,
        bodyDigest,
        actionDigest,
        recipientDigest: federationDigest({ recipientId: actorId }),
      }) as any,
    );
    const result = runtime.sandbox.execute({
      template,
      templateDigest: template.digest,
      arguments: body.arguments,
    });
    return { ...result, validationOnly: true, sideEffectsExecuted: false };
  });
  app.post("/v1/federation/tools/inspect", async (request) => {
    runtime.assertEnabled("snapshot_tools");
    const actorId = await actor(options, request);
    const body = request.body as { templateId: string };
    if (runtime.templateOwner(body.templateId) !== actorId)
      throw new ProblemError("permission_denied");
    return runtime.sandbox.inspectSandbox(runtime.tools.get(body.templateId));
  });

  app.post("/v1/federation/patches", async (request, reply) => {
    runtime.assertEnabled("snapshot_tools_patch");
    const actorId = await actor(options, request);
    const body = request.body as any;
    const manifest = runtime.manifests.get(body.baseSnapshotId);
    if (manifest === undefined) throw new ProblemError("not_found");
    if (runtime.manifestOwner(manifest.id) !== actorId) throw new ProblemError("permission_denied");
    const fileChanges = (body.fileChanges as any[]).map((change) => {
      const entry = manifest.entries.find((candidate) => candidate.logicalPath === change.path);
      if (entry === undefined)
        throw new ProblemError("invalid_request", { detail: "patch_base_entry_not_found" });
      return { ...change, baseDigest: entry.contentDigest };
    });
    const proposal = createPatchProposal({
      ...body,
      nodeId: manifest.nodeId,
      baseManifestDigest: federationDigest(manifest),
      fileChanges,
    });
    return reply.code(201).send(runtime.registerPatch(actorId, proposal));
  });
  app.post("/v1/federation/patches/apply", async (request) => {
    runtime.assertEnabled("snapshot_tools_patch");
    const actorId = await actor(options, request);
    const body = request.body as any;
    const proposal = runtime.patchForOwner(body.patchId, actorId);
    const grant = operationGrant(
      runtime,
      body.independentGrantId,
      actorId,
      "patch.apply",
      proposal.patchDigest,
    );
    const manifest = runtime.manifests.get(proposal.baseSnapshotId);
    if (manifest === undefined || runtime.manifestOwner(manifest.id) !== actorId)
      throw new ProblemError("permission_denied");
    const currentFileDigests = Object.fromEntries(
      manifest.entries
        .filter((entry) => entry.logicalPath !== undefined)
        .map((entry) => [entry.logicalPath, entry.contentDigest]),
    );
    const payload = { patchId: proposal.id, independentGrantId: grant.id };
    const bodyDigest = federationDigest(payload);
    const actionDigest = federationDigest({ operation: "patch.apply", bodyDigest });
    runtime.tickets.accept(
      runtime.ticketInput({
        ticket: body.ticket,
        grant,
        bodyDigest,
        actionDigest,
        recipientDigest: federationDigest({ recipientId: actorId }),
      }) as any,
    );
    const result = applyPatch({
      proposal,
      independentGrantId: grant.id,
      currentFileDigests,
      journalRef: `validation://patch/${proposal.id}`,
    });
    return { ...result, validationOnly: true, sideEffectsExecuted: false };
  });
  app.post("/v1/federation/transfers", async (request, reply) => {
    runtime.assertEnabled("snapshot_tools_patch");
    const actorId = await actor(options, request);
    const body = request.body as Record<string, unknown>;
    runtime.registerTransfer(actorId, body);
    return reply.code(201).send({ id: body.id, ownerId: actorId });
  });

  app.post("/v1/federation/transfers/:transferId/approvals", async (request, reply) => {
    runtime.assertEnabled("snapshot_tools_patch");
    const actorId = await actor(options, request);
    const params = request.params as { transferId: string };
    const body = request.body as any;
    if (!["source_owner", "recipient_owner"].includes(body.approverRole))
      throw new ProblemError("invalid_request");
    runtime.recordTransferApproval(params.transferId, body.approverRole, actorId);
    return reply.code(201).send({
      transferId: params.transferId,
      approverRole: body.approverRole,
      approverId: actorId,
    });
  });

  app.post("/v1/federation/artifacts/transfer", async (request) => {
    runtime.assertEnabled("snapshot_tools_patch");
    const actorId = await actor(options, request);
    const body = request.body as { id: string };
    const stored = runtime.transferInput(body.id, actorId);
    const result = transferArtifact({
      ...stored,
      approvals: runtime.transferApprovals(body.id),
      federationLevel: "snapshot_tools_patch",
    } as any);
    return {
      ...result,
      validationOnly: true,
      payloadTransferred: false,
      recipientArtifactVersions: 0,
    };
  });

  app.post("/v1/federation/handoffs/prepare", async (request) => {
    const actorId = await actor(options, request);
    const body = request.body as { grantId: string }[];
    const grants = body.map(({ grantId }) => {
      const grant = runtime.grants.get(grantId);
      if (
        !runtime.grants.verify(grantId) ||
        (grant.ownerId !== actorId && !grant.recipientRules.recipientIds.includes(actorId))
      )
        throw new ProblemError("permission_denied");
      return grant;
    });
    return prepareFederatedHandoff(grants);
  });
  app.post("/v1/federation/handoffs/accept", async (request) => {
    const actorId = await actor(options, request);
    const body = request.body as { highRisk: boolean; transferId?: string };
    const approvals =
      body.transferId === undefined ? [] : runtime.transferApprovals(body.transferId);
    if (body.highRisk) runtime.transferInput(body.transferId ?? "", actorId);
    return acceptFederatedHandoff({
      highRisk: body.highRisk,
      sourceReconfirmed: approvals.some((approval) => approval.approverRole === "source_owner"),
      recipientReconfirmed: approvals.some(
        (approval) => approval.approverRole === "recipient_owner",
      ),
    });
  });

  app.post("/v1/federation/archive-exports", async (request, reply) => {
    runtime.assertEnabled("snapshot");
    const body = request.body as { base: Record<string, unknown>; supplement: any };
    const manifest = exportFederatedArchive(body.base, body.supplement);
    return reply.type("application/json").send(Buffer.from(serializeFederatedArchive(manifest)));
  });
}
