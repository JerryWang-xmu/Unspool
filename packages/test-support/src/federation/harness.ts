import {
  exportFederatedArchive,
  serializeFederatedArchive,
} from "../../../../apps/runner-api/src/federation/archive-exporter.js";
import { transferArtifact } from "../../../../apps/runner-api/src/federation/artifact-transfer.js";
import { NodeDirectiveService } from "../../../../apps/runner-api/src/federation/directives.js";
import {
  FixedToolRegistry,
  FixedToolSandbox,
} from "../../../../apps/runner-api/src/federation/fixed-tools.js";
import { FederationGrantService } from "../../../../apps/runner-api/src/federation/grant-service.js";
import {
  acceptFederatedHandoff,
  prepareFederatedHandoff,
} from "../../../../apps/runner-api/src/federation/handoff.js";
import {
  createInjectionReview,
  inspectNodeInjection,
} from "../../../../apps/runner-api/src/federation/injection-guard.js";
import { OperationTicketService } from "../../../../apps/runner-api/src/federation/operation-tickets.js";
import { FederationPairingService } from "../../../../apps/runner-api/src/federation/pairing.js";
import {
  applyPatch,
  createPatchProposal,
} from "../../../../apps/runner-api/src/federation/patch.js";
import { intersectDataRights } from "../../../../apps/runner-api/src/federation/propagation.js";
import { FederationReceiptLog } from "../../../../apps/runner-api/src/federation/receipts.js";
import { SnapshotService } from "../../../../apps/runner-api/src/federation/snapshot-service.js";
import { B0_GRANT_DIGESTS, createB0FederationFixture } from "./fixtures.js";
import * as B1 from "./tool-fixtures.js";

function ok(value: unknown) {
  return { ok: true as const, value };
}
function failure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const extra =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  return { ok: false as const, error: { status: 400, code: detail, ...extra } };
}

export async function createFederationHarness() {
  const fixture = await createB0FederationFixture();
  const pairing = new FederationPairingService(() => Date.parse(fixture.now));
  const grants = new FederationGrantService(() => new Date(fixture.now));
  const tickets = new OperationTicketService(() => new Date(fixture.now));
  const snapshots = new SnapshotService({
    now: () => new Date(fixture.now),
    newId: () => "snapshot-harness",
  });
  const receipts = new FederationReceiptLog(() => new Date(fixture.now));
  const tools = new FixedToolRegistry();
  const sandbox = new FixedToolSandbox();
  const directives = new NodeDirectiveService();
  const created = new Map<string, B0SnapshotManifest>();

  return {
    fixture,
    b1: B1,
    pairing: {
      createCode: (ownerId: string) => ok(pairing.createCode(ownerId)),
      complete: (nodeId: string, code: string) => {
        try {
          return ok(pairing.complete(nodeId, code));
        } catch (error) {
          return failure(error);
        }
      },
      rotate: (nodeId: string) => {
        try {
          return ok(pairing.rotate(nodeId));
        } catch (error) {
          return failure(error);
        }
      },
      get: (nodeId: string) => {
        try {
          return ok(pairing.get(nodeId));
        } catch (error) {
          return failure(error);
        }
      },
    },
    grants: {
      registerOwner: (ownerId: string) => ok(grants.registerOwner(ownerId)),
      propose: (input: any) => ok(grants.propose(input)),
      decide: (id: string, decision: "active" | "rejected" | "revoked", reduction?: any) => {
        try {
          return ok(grants.decide(id, decision, reduction));
        } catch (error) {
          return failure(error);
        }
      },
      get: (id: string) => {
        try {
          return ok(grants.get(id));
        } catch (error) {
          return failure(error);
        }
      },
      verify: (id: string) => ok(grants.verify(id)),
      digest: (grant: any) => ok(grantDigest(grant)),
    },
    tickets: {
      accept: (input: any) => {
        try {
          return ok(
            tickets.accept({
              grantDigest: B0_GRANT_DIGESTS[input.grant.state as keyof typeof B0_GRANT_DIGESTS],
              actionDigest: input.ticket.actionDigest,
              verifyGrant: (grant) => grant.ownerSignature.startsWith("fixture-owner-signature:"),
              verifySignature: (ticket) => ticket.signature.startsWith("fixture-ticket-signature:"),
              ...input,
            }),
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    snapshots: {
      create: async (input: any = {}) => {
        try {
          const manifest = await snapshots.create({
            nodeId: input.nodeId ?? "node",
            resourceId: input.resourceId ?? "resource",
            root: input.root ?? fixture.paths.snapshotRoot,
            logicalPaths: input.logicalPaths ?? ["in/brief.md", "in/nested/example.ts"],
            pathVisibility: input.pathVisibility ?? "opaque_only",
            cachePolicy: input.cachePolicy ?? { centralCache: false, offlineRead: false },
          });
          created.set(manifest.id, manifest);
          return ok(manifest);
        } catch (error) {
          return failure(error);
        }
      },
      read: (manifest: B0SnapshotManifest, entryId: string) => {
        try {
          return ok(snapshots.readEntry(manifest, entryId));
        } catch (error) {
          return failure(error);
        }
      },
      readOffline: (manifest: B0SnapshotManifest, entryId: string) => {
        try {
          return ok(snapshots.readOffline(manifest, entryId));
        } catch (error) {
          return failure(error);
        }
      },
      readCentral: (manifest: B0SnapshotManifest, entryId: string) => {
        try {
          return ok(snapshots.readCentral(manifest, entryId));
        } catch (error) {
          return failure(error);
        }
      },
    },
    labels: {
      derive: (source: any, recipient: any, requested: any) =>
        ok(intersectDataRights(source, recipient, requested)),
    },
    receipts: {
      append: (receipt: any) => {
        try {
          return ok(receipts.append(receipt));
        } catch (error) {
          return failure(error);
        }
      },
      backfill: (receipt: any) => {
        try {
          return ok(receipts.backfill(receipt));
        } catch (error) {
          return failure(error);
        }
      },
      list: (nodeId?: string) => ok(receipts.list(nodeId)),
      gaps: (nodeId?: string) => ok(receipts.gaps(nodeId)),
      reviewMalicious: (items: any[]) => ok(receipts.reviewMalicious(items)),
    },
    tools: {
      register: (template: any) => {
        try {
          return ok(tools.register(template));
        } catch (error) {
          return failure(error);
        }
      },
      execute: (input: any) => {
        try {
          return ok(sandbox.execute(input));
        } catch (error) {
          return failure(error);
        }
      },
      inspectSandbox: (template: any) => ok(sandbox.inspectSandbox(template)),
    },
    patches: {
      propose: (input: any) => {
        try {
          return ok(createPatchProposal(input));
        } catch (error) {
          return failure(error);
        }
      },
      apply: (input: any) => {
        try {
          return ok(applyPatch(input));
        } catch (error) {
          return failure(error);
        }
      },
    },
    artifacts: {
      transfer: (input: any) => {
        try {
          return ok(
            transferArtifact({
              ...input,
              artifact: {
                ...input.artifact,
                contentDigest: input.artifact.contentDigest ?? B1.B1_NODE_ARTIFACT.contentDigest,
                originOwnerIds: input.artifact.originOwnerIds ?? B1.B1_NODE_ARTIFACT.originOwnerIds,
              },
            }),
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    injection: {
      inspect: (receipt: any) => ok(inspectNodeInjection(receipt)),
      review: (input: any) => ok(createInjectionReview(input)),
    },
    nodes: {
      apply: (nodeId: string, state: any, revision: number, reason: string) =>
        ok(directives.apply(nodeId, state, revision, reason)),
      unquarantine: (nodeId: string, revision: number, localOwner: boolean) => {
        try {
          return ok(directives.unquarantine(nodeId, revision, localOwner));
        } catch (error) {
          return failure(error);
        }
      },
      get: (nodeId: string) => ok(directives.get(nodeId)),
      canUse: (nodeId: string) => ok(directives.canUse(nodeId)),
      recover: (nodeId: string, dispatched: boolean, completed: boolean) =>
        ok(directives.recover(nodeId, dispatched, completed)),
    },
    handoffs: {
      prepare: (grants: any[]) => ok(prepareFederatedHandoff(grants)),
      accept: (input: any) => {
        try {
          return ok(acceptFederatedHandoff(input));
        } catch (error) {
          return failure(error);
        }
      },
    },
    archives: {
      export: (base: any, supplement: any) => ok(exportFederatedArchive(base, supplement)),
      readOffline: (manifest: any) =>
        ok(JSON.parse(new TextDecoder().decode(serializeFederatedArchive(manifest)))),
    },
    async close() {
      await fixture.cleanup();
    },
  };
}

import { grantDigest } from "../../../../apps/runner-api/src/federation/grant-service.js";
import type { B0SnapshotManifest } from "./fixtures.js";
