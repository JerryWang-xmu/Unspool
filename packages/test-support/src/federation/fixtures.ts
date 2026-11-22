import { createHash, randomBytes } from "node:crypto";
import { symlink as createSymlink, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Synthetic B0 federation fixtures.
 *
 * Scope is the closed read-only Beta only: explicit snapshots, path visibility,
 * owner-controlled read Grants, OperationTickets, and receipt integrity gaps.
 * Nothing here creates fixed tools, Patch proposals, cross-domain propagation,
 * network listeners, real credentials, or cryptographic signatures.
 */

export type B0PathVisibility = "opaque_only" | "authorized_recipients" | "owner_only";

export type B0GrantState = "active" | "expired" | "revoked" | "rejected";

export type B0ReceiptUploadState = "pending" | "accepted" | "duplicate" | "gap";

export type B0FixtureFileRole =
  | "selected"
  | "not_selected"
  | "outside"
  | "sibling"
  | "toctou_replacement";

export type B0CanaryId = "outside" | "sibling" | "not_selected" | "toctou_replacement";

export interface B0FixtureFile {
  readonly role: B0FixtureFileRole;
  readonly path: string;
  readonly relativePath: string;
  readonly size: number;
  readonly contentDigest: string;
}

export interface B0Canary {
  readonly id: B0CanaryId;
  readonly path: string;
  readonly token: string;
}

export interface B0SnapshotEntry {
  readonly entryId: string;
  readonly logicalPath?: string;
  readonly type: "regular_file";
  readonly size: number;
  readonly contentDigest: string;
}

export interface B0SnapshotManifest {
  readonly id: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly rootDigest: string;
  readonly entries: readonly B0SnapshotEntry[];
  readonly createdAt: string;
  readonly pathVisibility: B0PathVisibility;
  readonly cachePolicy: {
    readonly centralCache: boolean;
    readonly offlineRead: boolean;
  };
  readonly state: "sealed";
}

export interface B0GrantRecipientRules {
  readonly recipientIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly destinationNodeIds: readonly string[];
}

export interface B0GrantRights {
  readonly content: "read_only";
  readonly modelDisclose: boolean;
  readonly memberDisclose: boolean;
  readonly cache: boolean;
  readonly domainPropagate: boolean;
}

export interface B0Grant {
  readonly id: string;
  readonly nodeId: string;
  readonly ownerId: string;
  readonly teamId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly purposeDigest: string;
  readonly resourceId: string;
  readonly resourceDigest: string;
  readonly operations: readonly string[];
  readonly requesterIds: readonly string[];
  readonly recipientRules: B0GrantRecipientRules;
  readonly rights: B0GrantRights;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly usageLimit: number;
  readonly budget: {
    readonly maxReadBytes: number;
    readonly maxOperations: number;
  };
  readonly cachePolicy: {
    readonly centralCache: boolean;
    readonly offlineRead: boolean;
  };
  readonly handoffPolicy: "no_transfer";
  readonly policyRevision: number;
  readonly ownerSignature: string;
  readonly state: B0GrantState;
}

export interface B0OperationTicket {
  readonly requestId: string;
  readonly nonce: string;
  readonly executionId: string;
  readonly nodeId: string;
  readonly runId: string;
  readonly grantDigest: string;
  readonly actionDigest: string;
  readonly recipientDigest: string;
  readonly bodyDigest: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export type B0PathProbeKind =
  | "absolute_path"
  | "parent_traversal"
  | "nested_parent_traversal"
  | "backslash_parent_traversal"
  | "same_prefix_sibling"
  | "symlink";

export interface B0PathProbe {
  readonly kind: B0PathProbeKind;
  readonly value: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
}

export interface B0SymlinkProbe {
  readonly path: string;
  readonly target: string;
  readonly created: boolean;
  readonly unavailableReason?: string;
}

export interface B0ToctouScenario {
  readonly id: "snapshot-swap-after-verification";
  readonly targetPath: string;
  readonly replacementPath: string;
  readonly steps: readonly string[];
  readonly invariant: string;
}

export interface B0ReceiptResult {
  readonly outcome: "reported_success" | "reported_failure";
  readonly entryIds: readonly string[];
  readonly claimedBytes: number;
  readonly evidenceIds: readonly string[];
}

export interface B0NodeReceipt {
  readonly eventId: string;
  readonly nodeId: string;
  readonly nodeSequence: number;
  readonly previousDigest: string;
  readonly runId: string;
  readonly requestId: string;
  readonly executionId?: string;
  readonly actor: string;
  readonly resourceDigest: string;
  readonly operation: string;
  readonly grantDigest: string;
  readonly decision: "accepted" | "denied";
  readonly reason: string;
  readonly occurredAt: string;
  readonly result: B0ReceiptResult;
  readonly byteCount: number;
  readonly destinations: readonly string[];
  readonly labelDigest: string;
  readonly uploadState: B0ReceiptUploadState;
  readonly nodeSignature: string;
}

export interface B0ReceiptGap {
  readonly nodeId: string;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly detectedAt: string;
  readonly reason: string;
  readonly resolvedAt?: string;
}

export interface B0FederationFixture {
  readonly now: string;
  readonly tree: readonly B0FixtureFile[];
  readonly canaries: readonly B0Canary[];
  readonly paths: {
    readonly root: string;
    readonly snapshotRoot: string;
    readonly symlink: string;
    readonly toctouTarget: string;
    readonly toctouReplacement: string;
  };
  readonly snapshot: {
    readonly manifest: B0SnapshotManifest;
    readonly variants: {
      readonly opaqueOnly: B0SnapshotManifest;
      readonly authorizedRecipients: B0SnapshotManifest;
      readonly ownerOnly: B0SnapshotManifest;
    };
  };
  readonly grants: Readonly<Record<B0GrantState, B0Grant>>;
  readonly tickets: {
    readonly valid: B0OperationTicket;
    readonly expired: B0OperationTicket;
    readonly revoked: B0OperationTicket;
    readonly rejected: B0OperationTicket;
  };
  readonly pathProbes: readonly B0PathProbe[];
  readonly symlink: B0SymlinkProbe;
  readonly toctou: B0ToctouScenario;
  readonly receipts: {
    readonly beforeGap: B0NodeReceipt;
    readonly afterGap: B0NodeReceipt;
    readonly gap: B0ReceiptGap;
  };
  readonly maliciousNode: {
    readonly nodeId: string;
    readonly forgedSuccess: B0NodeReceipt;
    readonly contradictory: readonly [B0NodeReceipt, B0NodeReceipt];
  };
  readonly cleanup: () => Promise<void>;
}

export interface B0FixtureOptions {
  readonly now?: Date | string;
  readonly baseDir?: string;
}

export const B0_CANARY_PREFIX = "UNSPOOL_TEST_CANARY_";

const CANARY_SUFFIX = "_NOT_A_SECRET";
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const B0_IDS = {
  owner: "018f2d8f-3001-7f20-80b1-aaaaaaaaaaa1",
  node: "018f2d8f-3002-7f20-80b1-aaaaaaaaaaa1",
  maliciousNode: "018f2d8f-3003-7f20-80b1-aaaaaaaaaaa1",
  team: "018f2d8f-3004-7f20-80b1-aaaaaaaaaaa1",
  workspace: "018f2d8f-3005-7f20-80b1-aaaaaaaaaaa1",
  run: "018f2d8f-3006-7f20-80b1-aaaaaaaaaaa1",
  resource: "018f2d8f-3007-7f20-80b1-aaaaaaaaaaa1",
  snapshot: "018f2d8f-3008-7f20-80b1-aaaaaaaaaaa1",
  requester: "018f2d8f-3009-7f20-80b1-aaaaaaaaaaa1",
  recipient: "018f2d8f-3010-7f20-80b1-aaaaaaaaaaa1",
} as const;

const digestOf = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

/**
 * Fixture-only labels. They are deterministic hashes of labels, not the
 * canonical Grant digest produced by a node or the security package.
 */
export const B0_GRANT_DIGESTS: Readonly<Record<B0GrantState, string>> = {
  active: digestOf("fixture-grant-digest:active"),
  expired: digestOf("fixture-grant-digest:expired"),
  revoked: digestOf("fixture-grant-digest:revoked"),
  rejected: digestOf("fixture-grant-digest:rejected"),
};

const GRANT_IDS: Readonly<Record<B0GrantState, string>> = {
  active: "018f2d8f-3101-7f20-80b1-aaaaaaaaaaa1",
  expired: "018f2d8f-3102-7f20-80b1-aaaaaaaaaaa1",
  revoked: "018f2d8f-3103-7f20-80b1-aaaaaaaaaaa1",
  rejected: "018f2d8f-3104-7f20-80b1-aaaaaaaaaaa1",
};

type B0TicketCase = "valid" | "expired" | "revoked" | "rejected";

const TICKET_IDS: Readonly<
  Record<
    B0TicketCase,
    { readonly requestId: string; readonly executionId: string; readonly nonce: string }
  >
> = {
  valid: {
    requestId: "018f2d8f-3201-7f20-80b1-aaaaaaaaaaa1",
    executionId: "018f2d8f-3202-7f20-80b1-aaaaaaaaaaa1",
    nonce: "fixture-nonce-valid-not-a-secret",
  },
  expired: {
    requestId: "018f2d8f-3203-7f20-80b1-aaaaaaaaaaa1",
    executionId: "018f2d8f-3204-7f20-80b1-aaaaaaaaaaa1",
    nonce: "fixture-nonce-expired-not-a-secret",
  },
  revoked: {
    requestId: "018f2d8f-3205-7f20-80b1-aaaaaaaaaaa1",
    executionId: "018f2d8f-3206-7f20-80b1-aaaaaaaaaaa1",
    nonce: "fixture-nonce-revoked-not-a-secret",
  },
  rejected: {
    requestId: "018f2d8f-3207-7f20-80b1-aaaaaaaaaaa1",
    executionId: "018f2d8f-3208-7f20-80b1-aaaaaaaaaaa1",
    nonce: "fixture-nonce-rejected-not-a-secret",
  },
};

const SELECTED_FILES: readonly {
  readonly entryId: string;
  readonly logicalPath: string;
  readonly relativePath: string;
  readonly content: string;
}[] = [
  {
    entryId: "opaque-entry-1",
    logicalPath: "in/brief.md",
    relativePath: "snapshot/in/brief.md",
    content: "# B0 fixture brief\n\nSynthetic read-only content for snapshot scope tests.\n",
  },
  {
    entryId: "opaque-entry-2",
    logicalPath: "in/nested/example.ts",
    relativePath: "snapshot/in/nested/example.ts",
    content: 'export const fixtureValue = "b0";\n',
  },
];

const CANARY_SPECS: readonly {
  readonly id: B0CanaryId;
  readonly role: Exclude<B0FixtureFileRole, "selected">;
  readonly relativePath: string;
}[] = [
  {
    id: "not_selected",
    role: "not_selected",
    relativePath: "snapshot/not-selected/personal-note.txt",
  },
  { id: "outside", role: "outside", relativePath: "outside/secret-canary.txt" },
  { id: "sibling", role: "sibling", relativePath: "snapshot-evil/secret-canary.txt" },
  {
    id: "toctou_replacement",
    role: "toctou_replacement",
    relativePath: "outside/toctou-replacement.txt",
  },
];

const GRANT_WINDOWS: Readonly<
  Record<B0GrantState, { readonly notBefore: number; readonly expiresAt: number }>
> = {
  active: { notBefore: -30 * SECOND, expiresAt: 10 * MINUTE },
  expired: { notBefore: -2 * 60 * MINUTE, expiresAt: -60 * MINUTE },
  revoked: { notBefore: -60 * MINUTE, expiresAt: 60 * MINUTE },
  rejected: { notBefore: -60 * MINUTE, expiresAt: 60 * MINUTE },
};

const TICKET_WINDOWS: Readonly<
  Record<B0TicketCase, { readonly notBefore: number; readonly expiresAt: number }>
> = {
  valid: { notBefore: -SECOND, expiresAt: 30 * SECOND },
  expired: { notBefore: -90 * MINUTE, expiresAt: -89 * MINUTE },
  revoked: { notBefore: -30 * SECOND, expiresAt: 30 * SECOND },
  rejected: { notBefore: -30 * SECOND, expiresAt: 30 * SECOND },
};

const toDate = (value: Date | string): Date => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid fixture instant: ${String(value)}`);
  }

  return date;
};

const canaryToken = (id: B0CanaryId): string =>
  `${B0_CANARY_PREFIX}${id.toUpperCase()}_${randomBytes(8).toString("hex")}${CANARY_SUFFIX}`;

const materializeFile = async (
  root: string,
  role: B0FixtureFileRole,
  relativePath: string,
  content: string,
): Promise<B0FixtureFile> => {
  const path = join(root, relativePath);
  const bytes = Buffer.from(content, "utf8");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });

  return {
    role,
    path,
    relativePath,
    size: bytes.byteLength,
    contentDigest: digestOf(bytes),
  };
};

const buildManifest = (
  pathVisibility: B0PathVisibility,
  selectedFiles: readonly {
    readonly source: (typeof SELECTED_FILES)[number];
    readonly file: B0FixtureFile;
  }[],
  createdAt: string,
): B0SnapshotManifest => {
  const entries = selectedFiles.map(({ source, file }): B0SnapshotEntry => {
    return {
      entryId: source.entryId,
      ...(pathVisibility === "opaque_only" ? {} : { logicalPath: source.logicalPath }),
      type: "regular_file",
      size: file.size,
      contentDigest: file.contentDigest,
    };
  });

  const rootDigest = digestOf(
    entries
      .map((entry) => `${entry.entryId}:${entry.contentDigest}`)
      .sort()
      .join("\n"),
  );

  return {
    id: B0_IDS.snapshot,
    nodeId: B0_IDS.node,
    resourceId: B0_IDS.resource,
    rootDigest,
    entries,
    createdAt,
    pathVisibility,
    cachePolicy: { centralCache: false, offlineRead: false },
    state: "sealed",
  };
};

const buildGrant = (
  state: B0GrantState,
  resourceDigest: string,
  isoAt: (offsetMilliseconds: number) => string,
): B0Grant => {
  const window = GRANT_WINDOWS[state];

  return {
    id: GRANT_IDS[state],
    nodeId: B0_IDS.node,
    ownerId: B0_IDS.owner,
    teamId: B0_IDS.team,
    workspaceId: B0_IDS.workspace,
    runId: B0_IDS.run,
    purposeDigest: digestOf("fixture-purpose:snapshot-preview"),
    resourceId: B0_IDS.resource,
    resourceDigest,
    operations: ["snapshot.read"],
    requesterIds: [B0_IDS.requester],
    recipientRules: {
      recipientIds: [B0_IDS.recipient],
      modelIds: [],
      destinationNodeIds: [],
    },
    rights: {
      content: "read_only",
      modelDisclose: false,
      memberDisclose: false,
      cache: false,
      domainPropagate: false,
    },
    notBefore: isoAt(window.notBefore),
    expiresAt: isoAt(window.expiresAt),
    usageLimit: 1,
    budget: { maxReadBytes: 4_096, maxOperations: 1 },
    cachePolicy: { centralCache: false, offlineRead: false },
    handoffPolicy: "no_transfer",
    policyRevision: state === "revoked" ? 3 : 1,
    ownerSignature: `fixture-owner-signature:${state}:not-a-real-signature`,
    state,
  };
};

const buildTicket = (
  ticketCase: B0TicketCase,
  grant: B0Grant,
  isoAt: (offsetMilliseconds: number) => string,
): B0OperationTicket => {
  const ids = TICKET_IDS[ticketCase];
  const window = TICKET_WINDOWS[ticketCase];

  return {
    requestId: ids.requestId,
    nonce: ids.nonce,
    executionId: ids.executionId,
    nodeId: grant.nodeId,
    runId: grant.runId,
    grantDigest: B0_GRANT_DIGESTS[grant.state],
    actionDigest: digestOf("fixture-action:snapshot.read"),
    recipientDigest: digestOf(`fixture-recipient:${B0_IDS.recipient}`),
    bodyDigest: digestOf(
      `fixture-snapshot-body:${B0_IDS.snapshot}:${SELECTED_FILES.map((file) => file.entryId).join(
        ",",
      )}`,
    ),
    notBefore: isoAt(window.notBefore),
    expiresAt: isoAt(window.expiresAt),
    signature: `fixture-ticket-signature:${ticketCase}:not-a-real-signature`,
  };
};

interface ReceiptInput {
  readonly nodeId: string;
  readonly eventId: string;
  readonly nodeSequence: number;
  readonly previousDigest: string;
  readonly requestId: string;
  readonly executionId: string;
  readonly occurredAt: Date;
  readonly reason: string;
  readonly result: B0ReceiptResult;
  readonly uploadState: B0ReceiptUploadState;
  readonly signatureLabel: string;
}

const buildReceipt = (input: ReceiptInput, resourceDigest: string): B0NodeReceipt => {
  return {
    eventId: input.eventId,
    nodeId: input.nodeId,
    nodeSequence: input.nodeSequence,
    previousDigest: input.previousDigest,
    runId: B0_IDS.run,
    requestId: input.requestId,
    executionId: input.executionId,
    actor: B0_IDS.recipient,
    resourceDigest,
    operation: "snapshot.read",
    grantDigest: B0_GRANT_DIGESTS.active,
    decision: "accepted",
    reason: input.reason,
    occurredAt: input.occurredAt.toISOString(),
    result: input.result,
    byteCount: input.result.claimedBytes,
    destinations: [B0_IDS.recipient],
    labelDigest: digestOf("fixture-label:read-only"),
    uploadState: input.uploadState,
    nodeSignature: `fixture-node-signature:${input.signatureLabel}:not-a-real-signature`,
  };
};

export async function createB0FederationFixture(
  options: B0FixtureOptions = {},
): Promise<B0FederationFixture> {
  const now = toDate(options.now ?? new Date());
  const baseDir = resolve(options.baseDir ?? tmpdir());

  await mkdir(baseDir, { recursive: true });
  const root = await mkdtemp(join(baseDir, "unspool-b0-"));

  const at = (offsetMilliseconds: number): Date => new Date(now.getTime() + offsetMilliseconds);
  const isoAt = (offsetMilliseconds: number): string => at(offsetMilliseconds).toISOString();

  try {
    const tree: B0FixtureFile[] = [];
    const canaries: B0Canary[] = [];

    const selectedFiles: {
      readonly source: (typeof SELECTED_FILES)[number];
      readonly file: B0FixtureFile;
    }[] = [];

    for (const source of SELECTED_FILES) {
      const file = await materializeFile(root, "selected", source.relativePath, source.content);

      tree.push(file);
      selectedFiles.push({ source, file });
    }

    for (const spec of CANARY_SPECS) {
      const token = canaryToken(spec.id);
      const file = await materializeFile(root, spec.role, spec.relativePath, `${token}\n`);

      tree.push(file);
      canaries.push({ id: spec.id, path: file.path, token });
    }

    const canaryById = new Map(canaries.map((canary) => [canary.id, canary] as const));
    const canaryPath = (id: B0CanaryId): string => {
      const canary = canaryById.get(id);

      if (!canary) {
        throw new Error(`Missing B0 canary fixture: ${id}`);
      }

      return canary.path;
    };

    const selectedByLogicalPath = new Map(
      selectedFiles.map(({ source, file }) => [source.logicalPath, file] as const),
    );
    const toctouTarget = selectedByLogicalPath.get("in/brief.md");

    if (!toctouTarget) {
      throw new Error("Missing B0 TOCTOU target fixture");
    }

    const createdAt = isoAt(-MINUTE);
    const opaqueManifest = buildManifest("opaque_only", selectedFiles, createdAt);
    const authorizedManifest = buildManifest("authorized_recipients", selectedFiles, createdAt);
    const ownerManifest = buildManifest("owner_only", selectedFiles, createdAt);

    const grants: Readonly<Record<B0GrantState, B0Grant>> = {
      active: buildGrant("active", opaqueManifest.rootDigest, isoAt),
      expired: buildGrant("expired", opaqueManifest.rootDigest, isoAt),
      revoked: buildGrant("revoked", opaqueManifest.rootDigest, isoAt),
      rejected: buildGrant("rejected", opaqueManifest.rootDigest, isoAt),
    };

    const tickets = {
      valid: buildTicket("valid", grants.active, isoAt),
      expired: buildTicket("expired", grants.expired, isoAt),
      revoked: buildTicket("revoked", grants.revoked, isoAt),
      rejected: buildTicket("rejected", grants.rejected, isoAt),
    };

    const linksDirectory = join(root, "snapshot", "links");
    const symlinkPath = join(linksDirectory, "outside-canary");
    const outsideCanaryPath = canaryPath("outside");

    await mkdir(linksDirectory, { recursive: true });

    let symlink: B0SymlinkProbe;
    try {
      await createSymlink(
        outsideCanaryPath,
        symlinkPath,
        process.platform === "win32" ? "file" : undefined,
      );
      symlink = { path: symlinkPath, target: outsideCanaryPath, created: true };
    } catch (error) {
      symlink = {
        path: symlinkPath,
        target: outsideCanaryPath,
        created: false,
        unavailableReason: error instanceof Error ? error.message : String(error),
      };
    }

    const symlinkValue = join("links", "outside-canary");
    const pathProbes: B0PathProbe[] = [
      { kind: "absolute_path", value: outsideCanaryPath, available: true },
      { kind: "parent_traversal", value: "../outside/secret-canary.txt", available: true },
      {
        kind: "nested_parent_traversal",
        value: "in/../../outside/secret-canary.txt",
        available: true,
      },
      {
        kind: "backslash_parent_traversal",
        value: "..\\outside\\secret-canary.txt",
        available: true,
      },
      {
        kind: "same_prefix_sibling",
        value: "../snapshot-evil/secret-canary.txt",
        available: true,
      },
      symlink.created
        ? { kind: "symlink", value: symlinkValue, available: true }
        : {
            kind: "symlink",
            value: symlinkValue,
            available: false,
            unavailableReason: symlink.unavailableReason ?? "symlink_creation_failed",
          },
    ];

    const toctou: B0ToctouScenario = {
      id: "snapshot-swap-after-verification",
      targetPath: toctouTarget.path,
      replacementPath: canaryPath("toctou_replacement"),
      steps: [
        "The owner includes snapshot/in/brief.md in the explicit manifest and the node seals a private fixed-version copy.",
        "The harness verifies the manifest entry, then replaces the live path with the outside TOCTOU replacement before the node opens it.",
        "The node must keep reading the sealed copy and must never open or return the replacement bytes.",
      ],
      invariant:
        "Only bytes identified by the sealed manifest may be returned; absolute, traversal, sibling, symlink, and replacement targets remain unopened.",
    };

    const beforeGap = buildReceipt(
      {
        nodeId: B0_IDS.node,
        eventId: "018f2d8f-3301-7f20-80b1-aaaaaaaaaaa1",
        nodeSequence: 1_290,
        previousDigest: digestOf("fixture-receipt-chain:1289"),
        requestId: "018f2d8f-3401-7f20-80b1-aaaaaaaaaaa1",
        executionId: "018f2d8f-3402-7f20-80b1-aaaaaaaaaaa1",
        occurredAt: at(-6 * MINUTE),
        reason: "snapshot_read_reported",
        result: {
          outcome: "reported_success",
          entryIds: ["opaque-entry-1"],
          claimedBytes: 64,
          evidenceIds: [],
        },
        uploadState: "accepted",
        signatureLabel: "valid-node:1290",
      },
      opaqueManifest.rootDigest,
    );

    const afterGap = buildReceipt(
      {
        nodeId: B0_IDS.node,
        eventId: "018f2d8f-3302-7f20-80b1-aaaaaaaaaaa1",
        nodeSequence: 1_294,
        previousDigest: digestOf("fixture-receipt-chain:1293-missing"),
        requestId: "018f2d8f-3403-7f20-80b1-aaaaaaaaaaa1",
        executionId: "018f2d8f-3404-7f20-80b1-aaaaaaaaaaa1",
        occurredAt: at(-3 * MINUTE),
        reason: "snapshot_read_reported_after_gap",
        result: {
          outcome: "reported_success",
          entryIds: ["opaque-entry-2"],
          claimedBytes: 32,
          evidenceIds: [],
        },
        uploadState: "gap",
        signatureLabel: "valid-node:1294",
      },
      opaqueManifest.rootDigest,
    );

    const gap: B0ReceiptGap = {
      nodeId: B0_IDS.node,
      fromSequence: 1_291,
      toSequence: 1_293,
      detectedAt: isoAt(-4 * MINUTE),
      reason: "missing_node_sequence",
    };

    const forgedSuccess = buildReceipt(
      {
        nodeId: B0_IDS.maliciousNode,
        eventId: "018f2d8f-3303-7f20-80b1-aaaaaaaaaaa1",
        nodeSequence: 41,
        previousDigest: digestOf("fixture-malicious-chain:40"),
        requestId: "018f2d8f-3411-7f20-80b1-aaaaaaaaaaa1",
        executionId: "018f2d8f-3421-7f20-80b1-aaaaaaaaaaa1",
        occurredAt: at(-2 * MINUTE),
        reason: "malicious_node_reported_success_without_evidence",
        result: {
          outcome: "reported_success",
          entryIds: ["opaque-entry-1"],
          claimedBytes: 999_999,
          evidenceIds: [],
        },
        uploadState: "accepted",
        signatureLabel: "malicious-node:forged-success",
      },
      opaqueManifest.rootDigest,
    );

    const contradictorySuccess = buildReceipt(
      {
        nodeId: B0_IDS.maliciousNode,
        eventId: "018f2d8f-3304-7f20-80b1-aaaaaaaaaaa1",
        nodeSequence: 42,
        previousDigest: digestOf("fixture-malicious-chain:41"),
        requestId: "018f2d8f-3412-7f20-80b1-aaaaaaaaaaa1",
        executionId: "018f2d8f-3422-7f20-80b1-aaaaaaaaaaa1",
        occurredAt: at(-90 * SECOND),
        reason: "malicious_node_reported_conflicting_success",
        result: {
          outcome: "reported_success",
          entryIds: ["opaque-entry-1"],
          claimedBytes: 1_024,
          evidenceIds: [],
        },
        uploadState: "accepted",
        signatureLabel: "malicious-node:contradiction-success",
      },
      opaqueManifest.rootDigest,
    );

    const contradictoryFailure = buildReceipt(
      {
        nodeId: B0_IDS.maliciousNode,
        eventId: "018f2d8f-3305-7f20-80b1-aaaaaaaaaaa1",
        nodeSequence: 43,
        previousDigest: digestOf("fixture-malicious-chain:42"),
        requestId: "018f2d8f-3412-7f20-80b1-aaaaaaaaaaa1",
        executionId: "018f2d8f-3422-7f20-80b1-aaaaaaaaaaa1",
        occurredAt: at(-60 * SECOND),
        reason: "malicious_node_reported_conflicting_failure",
        result: {
          outcome: "reported_failure",
          entryIds: [],
          claimedBytes: 0,
          evidenceIds: [],
        },
        uploadState: "accepted",
        signatureLabel: "malicious-node:contradiction-failure",
      },
      opaqueManifest.rootDigest,
    );

    let cleanedUp = false;
    const cleanup = async (): Promise<void> => {
      if (cleanedUp) {
        return;
      }

      await rm(root, { recursive: true, force: true });
      cleanedUp = true;
    };

    return {
      now: now.toISOString(),
      tree,
      canaries,
      paths: {
        root,
        snapshotRoot: join(root, "snapshot"),
        symlink: symlinkPath,
        toctouTarget: toctouTarget.path,
        toctouReplacement: canaryPath("toctou_replacement"),
      },
      snapshot: {
        manifest: opaqueManifest,
        variants: {
          opaqueOnly: opaqueManifest,
          authorizedRecipients: authorizedManifest,
          ownerOnly: ownerManifest,
        },
      },
      grants,
      tickets,
      pathProbes,
      symlink,
      toctou,
      receipts: { beforeGap, afterGap, gap },
      maliciousNode: {
        nodeId: B0_IDS.maliciousNode,
        forgedSuccess,
        contradictory: [contradictorySuccess, contradictoryFailure],
      },
      cleanup,
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
