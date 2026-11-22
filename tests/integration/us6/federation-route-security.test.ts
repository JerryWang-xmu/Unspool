import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBearerAuthenticator } from "../../../apps/runner-api/src/auth/bearer";
import { grantDigest } from "../../../apps/runner-api/src/federation/grant-service";
import { buildServer } from "../../../apps/runner-api/src/index";
import { federationDigest } from "../../../packages/contracts/src/federation-validation";

const directories: string[] = [];
const servers: { close: () => Promise<void> }[] = [];
const OWNER_TOKEN = "federation-route-owner-token";
const RECIPIENT_TOKEN = "federation-route-recipient-token";
const OUTSIDER_TOKEN = "federation-route-outsider-token";
const ownerId = createBearerAuthenticator({ token: OWNER_TOKEN }).identity.id;
const recipientId = "federation-recipient";
const outsiderId = "federation-outsider";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function subject() {
  const dataDir = await mkdtemp(join(tmpdir(), "unspool-federation-route-data-"));
  const resourceRoot = await mkdtemp(join(tmpdir(), "unspool-federation-route-resource-"));
  directories.push(dataDir, resourceRoot);
  await writeFile(join(resourceRoot, "brief.md"), "selected snapshot bytes");
  const server = await buildServer({
    dataDir,
    ownerToken: OWNER_TOKEN,
    additionalTokens: {
      [RECIPIENT_TOKEN]: { id: recipientId, displayName: "Recipient" },
      [OUTSIDER_TOKEN]: { id: outsiderId, displayName: "Outsider" },
    },
    federationLevel: "snapshot_tools_patch",
    federationValidation: true,
    host: "127.0.0.1",
    federationResourceRoots: { [`${ownerId}:resource-1`]: resourceRoot },
    verifyFederationTicket: (ticket) => ticket.signature === "validation-ticket-signature",
  });
  servers.push(server);
  return { server, resourceRoot };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function grantInput(overrides: Record<string, unknown> = {}) {
  return {
    id: `grant-${crypto.randomUUID()}`,
    nodeId: "node-1",
    ownerId,
    runId: "run-1",
    resourceId: "resource-1",
    resourceDigest: "sha256:pending",
    operations: ["snapshot.read"],
    recipientRules: { recipientIds: [recipientId], modelIds: [], destinationNodeIds: [] },
    notBefore: "2020-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    usageLimit: 1,
    policyRevision: 1,
    budget: { maxReadBytes: 1024, maxOperations: 1 },
    cachePolicy: { centralCache: true, offlineRead: false },
    ...overrides,
  };
}

describe("federation HTTP principal authorization", () => {
  it("denies cross-principal pairing, rotation and Grant decisions", async () => {
    const { server } = await subject();
    const paired = await server.inject({
      method: "POST",
      url: "/v1/federation/nodes/pair",
      headers: auth(OWNER_TOKEN),
      body: { ownerId: recipientId },
    });
    expect(paired.statusCode).toBe(201);
    const code = paired.json().code as string;
    const stolen = await server.inject({
      method: "POST",
      url: "/v1/federation/nodes/node-1/complete",
      headers: auth(RECIPIENT_TOKEN),
      body: { code },
    });
    expect(stolen.statusCode).toBe(403);
    const completed = await server.inject({
      method: "POST",
      url: "/v1/federation/nodes/node-1/complete",
      headers: auth(OWNER_TOKEN),
      body: { code },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().nodePrivateKey).toContain("PRIVATE KEY");
    const rotated = await server.inject({
      method: "POST",
      url: "/v1/federation/nodes/node-1/rotate",
      headers: auth(RECIPIENT_TOKEN),
      body: {},
    });
    expect(rotated.statusCode).toBe(403);

    const proposed = await server.inject({
      method: "POST",
      url: "/v1/federation/grants",
      headers: auth(OWNER_TOKEN),
      body: grantInput(),
    });
    expect(proposed.statusCode).toBe(201);
    const grantId = proposed.json().id as string;
    const forgedDecision = await server.inject({
      method: "POST",
      url: `/v1/federation/grants/${grantId}/decision`,
      headers: auth(RECIPIENT_TOKEN),
      body: { decision: "active" },
    });
    expect(forgedDecision.statusCode).toBe(403);
    const outsiderRead = await server.inject({
      method: "GET",
      url: `/v1/federation/grants/${grantId}`,
      headers: auth(OUTSIDER_TOKEN),
    });
    expect(outsiderRead.statusCode).toBe(403);
    const decision = await server.inject({
      method: "POST",
      url: `/v1/federation/grants/${grantId}/decision`,
      headers: auth(OWNER_TOKEN),
      body: { decision: "active" },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().ownerSignature).toBeTypeOf("string");
    const recipientRead = await server.inject({
      method: "GET",
      url: `/v1/federation/grants/${grantId}`,
      headers: auth(RECIPIENT_TOKEN),
    });
    expect(recipientRead.statusCode).toBe(200);
  });

  it("uses only server resource roots and binds central reads and tickets to the real Grant", async () => {
    const { server } = await subject();
    const registered = await server.inject({
      method: "POST",
      url: "/v1/federation/resources/register",
      headers: auth(OWNER_TOKEN),
      body: { resourceId: "resource-1", root: "C:/" },
    });
    expect(registered.statusCode).toBe(201);
    expect(JSON.stringify(registered.json())).not.toContain("C:/");
    const foreignRoot = await server.inject({
      method: "POST",
      url: "/v1/federation/resources/register",
      headers: auth(RECIPIENT_TOKEN),
      body: { resourceId: "resource-1", root: "C:/" },
    });
    expect(foreignRoot.statusCode).toBe(403);
    const snapshot = await server.inject({
      method: "POST",
      url: "/v1/federation/snapshots",
      headers: auth(OWNER_TOKEN),
      body: {
        nodeId: "node-1",
        resourceId: "resource-1",
        logicalPaths: ["brief.md"],
        pathVisibility: "authorized_recipients",
        cachePolicy: { centralCache: true, offlineRead: false },
      },
    });
    expect(snapshot.statusCode).toBe(201);
    const manifest = snapshot.json();
    const proposed = await server.inject({
      method: "POST",
      url: "/v1/federation/grants",
      headers: auth(OWNER_TOKEN),
      body: grantInput({ resourceDigest: manifest.rootDigest }),
    });
    const pending = proposed.json();
    const decided = await server.inject({
      method: "POST",
      url: `/v1/federation/grants/${pending.id}/decision`,
      headers: auth(OWNER_TOKEN),
      body: { decision: "active" },
    });
    const grant = decided.json();
    const entryId = manifest.entries[0].entryId as string;
    const denied = await server.inject({
      method: "GET",
      url: `/v1/federation/snapshots/${manifest.id}/entries/${entryId}?grantId=${grant.id}`,
      headers: auth(OUTSIDER_TOKEN),
    });
    expect(denied.statusCode).toBe(403);
    const url = `/v1/federation/snapshots/${manifest.id}/entries/${entryId}?grantId=${grant.id}`;
    const withoutTicket = await server.inject({
      method: "GET",
      url,
      headers: auth(RECIPIENT_TOKEN),
    });
    expect(withoutTicket.statusCode).toBe(403);

    const payload = { snapshotId: manifest.id, entryId };
    const bodyDigest = federationDigest(payload);
    const ticket = {
      requestId: "request-1",
      nonce: "0123456789abcdef",
      executionId: "execution-1",
      nodeId: grant.nodeId,
      runId: grant.runId,
      grantDigest: grantDigest(grant),
      actionDigest: federationDigest({ operation: "snapshot.read", bodyDigest }),
      recipientDigest: federationDigest({ recipientId }),
      bodyDigest,
      notBefore: "2020-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      signature: "validation-ticket-signature",
    };
    const ticketHeader = Buffer.from(JSON.stringify(ticket)).toString("base64url");
    const read = await server.inject({
      method: "GET",
      url,
      headers: { ...auth(RECIPIENT_TOKEN), "x-unspool-operation-ticket": ticketHeader },
    });
    expect(read.statusCode).toBe(200);
    expect(Buffer.from(read.json().bytes, "base64").toString()).toBe("selected snapshot bytes");
    expect(read.json().operation.oneTime).toBe(true);

    const replay = await server.inject({
      method: "GET",
      url,
      headers: { ...auth(RECIPIENT_TOKEN), "x-unspool-operation-ticket": ticketHeader },
    });
    expect(replay.statusCode).not.toBe(200);
    const differentTicket = {
      ...ticket,
      requestId: "request-2",
      nonce: "fedcba9876543210",
      executionId: "execution-2",
    };
    const exhausted = await server.inject({
      method: "GET",
      url,
      headers: {
        ...auth(RECIPIENT_TOKEN),
        "x-unspool-operation-ticket": Buffer.from(JSON.stringify(differentTicket)).toString(
          "base64url",
        ),
      },
    });
    expect(exhausted.statusCode).not.toBe(200);
    const directReplay = await server.inject({
      method: "POST",
      url: "/v1/federation/tickets/accept",
      headers: auth(RECIPIENT_TOKEN),
      body: { grantId: grant.id, operation: "snapshot.read", payload, ticket },
    });
    expect(directReplay.statusCode).not.toBe(200);

    const revoked = await server.inject({
      method: "POST",
      url: `/v1/federation/grants/${grant.id}/decision`,
      headers: auth(OWNER_TOKEN),
      body: { decision: "revoked" },
    });
    expect(revoked.json().state).toBe("revoked");
    const afterRevocation = await server.inject({
      method: "GET",
      url,
      headers: { ...auth(RECIPIENT_TOKEN), "x-unspool-operation-ticket": ticketHeader },
    });
    expect(afterRevocation.statusCode).toBe(403);
  });
});
