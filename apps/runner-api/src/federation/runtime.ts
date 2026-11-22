import type {
  B0Grant,
  B0OperationTicket,
  B0SnapshotManifest,
} from "../../../../packages/test-support/src/federation/fixtures.js";
import type {
  B1FixedToolTemplate,
  B1PatchProposal,
} from "../../../../packages/test-support/src/federation/tool-fixtures.js";
import { ProblemError } from "../errors/problem.js";
import { NodeDirectiveService } from "./directives.js";
import { FixedToolRegistry, FixedToolSandbox } from "./fixed-tools.js";
import type { FederationLevel } from "./gates.js";
import { federationAllows } from "./gates.js";
import { FederationGrantService, grantDigest } from "./grant-service.js";
import { FederationGrantStore } from "./grant-store.js";
import { OperationTicketService } from "./operation-tickets.js";
import { FederationPairingService } from "./pairing.js";
import { FederationReceiptLog } from "./receipts.js";
import { SnapshotService } from "./snapshot-service.js";
import { SqliteTicketConsumptionStore } from "./ticket-store.js";

export interface FederationRuntimeOptions {
  readonly databaseFilename?: string;
  readonly keysDirectory?: string;
  readonly verifyTicketSignature?: (ticket: B0OperationTicket) => boolean;
  readonly verifyGrantSignature?: (grant: B0Grant) => boolean;
  /** Server-configured owner/resource roots; request bodies can never select host paths. */
  readonly resourceRoots?: Readonly<Record<string, string>>;
}

export class FederationRuntime {
  readonly pairing = new FederationPairingService();
  readonly grants: FederationGrantService;
  readonly tickets: OperationTicketService;
  readonly snapshots = new SnapshotService();
  readonly receipts = new FederationReceiptLog();
  readonly tools = new FixedToolRegistry();
  readonly sandbox = new FixedToolSandbox();
  readonly directives = new NodeDirectiveService();
  readonly manifests = new Map<string, B0SnapshotManifest>();
  readonly #manifestOwners = new Map<string, string>();
  readonly level: FederationLevel;
  readonly #options: FederationRuntimeOptions;
  #closeStores: () => void = () => {};

  constructor(level: FederationLevel = "disabled", options: FederationRuntimeOptions = {}) {
    this.level = level;
    this.#options = options;
    for (const [key, root] of Object.entries(options.resourceRoots ?? {}))
      this.#resourceRoots.set(key, root);
    if (options.databaseFilename !== undefined) {
      const store = new FederationGrantStore(
        options.databaseFilename,
        options.keysDirectory ?? "keys",
      );
      const ticketStore = new SqliteTicketConsumptionStore(options.databaseFilename);
      this.grants = new FederationGrantService(undefined, store);
      this.tickets = new OperationTicketService(undefined, ticketStore);
      this.#closeStores = () => {
        ticketStore.close();
        store.close();
      };
    } else {
      this.grants = new FederationGrantService();
      this.tickets = new OperationTicketService();
    }
  }

  ticketInput(body: unknown): Record<string, unknown> {
    const input = body as Record<string, unknown>;
    const grant = input.grant as B0Grant;
    const local = this.grants.get(grant.id);
    return {
      ...input,
      grantDigest: grantDigest(local),
      actionDigest: input.actionDigest,
      verifyGrant: (candidate: B0Grant) =>
        this.grants.verify(candidate.id) &&
        (this.#options.verifyGrantSignature?.(candidate) ?? true),
      verifySignature: this.#options.verifyTicketSignature ?? (() => false),
    };
  }

  resourceRoot(ownerId: string, resourceId: string): string {
    const root = this.#resourceRoots.get(`${ownerId}:${resourceId}`);
    if (root === undefined)
      throw new ProblemError("permission_denied", {
        detail: "Resource root is not server-registered",
      });
    return root;
  }

  recordManifest(manifest: B0SnapshotManifest, ownerId: string): void {
    this.manifests.set(manifest.id, manifest);
    this.#manifestOwners.set(manifest.id, ownerId);
  }

  manifestOwner(snapshotId: string): string {
    const ownerId = this.#manifestOwners.get(snapshotId);
    if (ownerId === undefined) throw new ProblemError("not_found");
    return ownerId;
  }

  readonly #resourceRoots = new Map<string, string>();
  readonly #templateOwners = new Map<string, string>();
  readonly #patchProposals = new Map<string, { ownerId: string; proposal: B1PatchProposal }>();
  readonly #transfers = new Map<string, { ownerId: string; input: Record<string, unknown> }>();
  readonly #transferApprovals = new Map<
    string,
    {
      approverRole: "source_owner" | "recipient_owner";
      approverId: string;
      decision: "approved";
      decidedAt: string;
    }[]
  >();

  registerTemplate(ownerId: string, template: B1FixedToolTemplate): B1FixedToolTemplate {
    const owner = this.#templateOwners.get(template.id);
    if (owner !== undefined && owner !== ownerId) throw new ProblemError("permission_denied");
    const registered = this.tools.register(template);
    this.#templateOwners.set(template.id, ownerId);
    return registered;
  }

  templateOwner(templateId: string): string {
    const ownerId = this.#templateOwners.get(templateId);
    if (ownerId === undefined) throw new ProblemError("not_found");
    return ownerId;
  }

  registerPatch(ownerId: string, proposal: B1PatchProposal): B1PatchProposal {
    if (this.#patchProposals.has(proposal.id))
      throw new ProblemError("invalid_request", { detail: "patch_already_exists" });
    this.#patchProposals.set(proposal.id, { ownerId, proposal });
    return proposal;
  }

  patchForOwner(patchId: string, ownerId: string): B1PatchProposal {
    const stored = this.#patchProposals.get(patchId);
    if (stored === undefined) throw new ProblemError("not_found");
    if (stored.ownerId !== ownerId) throw new ProblemError("permission_denied");
    return stored.proposal;
  }

  registerTransfer(ownerId: string, body: Record<string, unknown>): void {
    const id = body.id;
    const artifact = body.artifact as { id?: unknown; originOwnerIds?: unknown } | undefined;
    const recipient = body.recipient as { ownerId?: unknown } | undefined;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      artifact === undefined ||
      typeof artifact.id !== "string" ||
      typeof recipient?.ownerId !== "string"
    )
      throw new ProblemError("invalid_request");
    if (this.#transfers.has(id))
      throw new ProblemError("invalid_request", { detail: "transfer_already_exists" });
    this.#transfers.set(id, {
      ownerId,
      input: {
        ...body,
        artifact: { ...artifact, originOwnerIds: [ownerId] },
        recipient: { ...recipient, ownerId: recipient.ownerId },
      },
    });
  }

  transferInput(transferId: string, actorId: string): Record<string, unknown> {
    const stored = this.#transfers.get(transferId);
    if (stored === undefined) throw new ProblemError("not_found");
    const recipient = stored.input.recipient as { ownerId: string };
    if (stored.ownerId !== actorId && recipient.ownerId !== actorId)
      throw new ProblemError("permission_denied");
    return stored.input;
  }

  recordTransferApproval(
    transferId: string,
    approverRole: "source_owner" | "recipient_owner",
    approverId: string,
  ): void {
    const stored = this.#transfers.get(transferId);
    if (stored === undefined) throw new ProblemError("not_found");
    const recipient = stored.input.recipient as { ownerId: string };
    if (
      (approverRole === "source_owner" && stored.ownerId !== approverId) ||
      (approverRole === "recipient_owner" && recipient.ownerId !== approverId)
    )
      throw new ProblemError("permission_denied");
    const approvals = this.#transferApprovals.get(transferId) ?? [];
    if (
      !approvals.some(
        (approval) => approval.approverRole === approverRole && approval.approverId === approverId,
      )
    ) {
      this.#transferApprovals.set(transferId, [
        ...approvals,
        { approverRole, approverId, decision: "approved", decidedAt: new Date().toISOString() },
      ]);
    }
  }

  transferApprovals(transferId: string) {
    return this.#transferApprovals.get(transferId) ?? [];
  }

  close(): void {
    this.#closeStores();
  }

  assertEnabled(required: "snapshot" | "snapshot_tools" | "snapshot_tools_patch"): void {
    if (!federationAllows({ globalLevel: this.level }, required))
      throw new ProblemError("permission_denied", {
        detail: `Federation level ${required} is not enabled.`,
      });
  }
}
