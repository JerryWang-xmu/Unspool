/**
 * B1 federation fixtures for fixed tools, shell-free sandboxes, Patch review,
 * cross-domain Artifact transfer, budget exhaustion, and unknown outcomes.
 *
 * Scope: QS-09 / UAT-43..48,52 / TO-12 / T11..16. These are data-only fixtures.
 * No real credential, private key, session token, or production endpoint appears
 * here. The `B1_FIXTURE_CANARY` value below is a deliberate non-secret marker.
 */

export type B1Digest = `sha256:${string}`;

export type B1JsonValue = string | number | boolean | null | readonly B1JsonValue[] | B1JsonObject;

export interface B1JsonObject {
  readonly [key: string]: B1JsonValue;
}

export type B1ToolRequestBody = B1JsonObject & {
  readonly templateId: string;
  readonly templateDigest: B1Digest;
  readonly arguments: B1JsonObject;
};

/**
 * Stable IDs. UUIDv7-shaped fixtures, not values copied from a real installation.
 */
export const B1_IDS = {
  sourceOwner: "018f2d8f-b101-7f20-80b1-aaaaaaaa0001",
  recipientOwner: "018f2d8f-b102-7f20-80b1-aaaaaaaa0002",
  sourceNode: "018f2d8f-b103-7f20-80b1-aaaaaaaa0003",
  recipientNode: "018f2d8f-b104-7f20-80b1-aaaaaaaa0004",
  thirdNode: "018f2d8f-b105-7f20-80b1-aaaaaaaa0005",
  sourceWorkspace: "018f2d8f-b106-7f20-80b1-aaaaaaaa0006",
  sourceRun: "018f2d8f-b107-7f20-80b1-aaaaaaaa0007",
  sourceResource: "018f2d8f-b108-7f20-80b1-aaaaaaaa0008",
  fixedToolTemplate: "018f2d8f-b109-7f20-80b1-aaaaaaaa0009",
  toolGrant: "018f2d8f-b10a-7f20-80b1-aaaaaaaa000a",
  toolExecution: "018f2d8f-b10b-7f20-80b1-aaaaaaaa000b",
  nodeOperation: "018f2d8f-b10c-7f20-80b1-aaaaaaaa000c",
  baseSnapshot: "018f2d8f-b10d-7f20-80b1-aaaaaaaa000d",
  patchProposal: "018f2d8f-b10e-7f20-80b1-aaaaaaaa000e",
  patchApplication: "018f2d8f-b10f-7f20-80b1-aaaaaaaa000f",
  patchGrant: "018f2d8f-b110-7f20-80b1-aaaaaaaa0010",
  sourceArtifact: "018f2d8f-b111-7f20-80b1-aaaaaaaa0011",
  artifactVersion: "018f2d8f-b112-7f20-80b1-aaaaaaaa0012",
  blob: "018f2d8f-b113-7f20-80b1-aaaaaaaa0013",
  sourceSecurityLabel: "018f2d8f-b114-7f20-80b1-aaaaaaaa0014",
  derivedSecurityLabel: "018f2d8f-b115-7f20-80b1-aaaaaaaa0015",
  transfer: "018f2d8f-b116-7f20-80b1-aaaaaaaa0016",
  deniedTransfer: "018f2d8f-b117-7f20-80b1-aaaaaaaa0017",
  toolRequest: "018f2d8f-b118-7f20-80b1-aaaaaaaa0018",
  operationExecution: "018f2d8f-b119-7f20-80b1-aaaaaaaa0019",
  budgetExhaustionExecution: "018f2d8f-b11a-7f20-80b1-aaaaaaaa001a",
  unknownBeforeRequest: "018f2d8f-b11b-7f20-80b1-aaaaaaaa001b",
  unknownBeforeOperation: "018f2d8f-b11c-7f20-80b1-aaaaaaaa001c",
  unknownBeforeExecution: "018f2d8f-b11d-7f20-80b1-aaaaaaaa001d",
  unknownBeforeToolExecution: "018f2d8f-b11e-7f20-80b1-aaaaaaaa001e",
  unknownAfterRequest: "018f2d8f-b11f-7f20-80b1-aaaaaaaa001f",
  unknownAfterOperation: "018f2d8f-b120-7f20-80b1-aaaaaaaa0020",
  unknownAfterExecution: "018f2d8f-b121-7f20-80b1-aaaaaaaa0021",
  unknownAfterToolExecution: "018f2d8f-b122-7f20-80b1-aaaaaaaa0022",
} as const;

/**
 * Most digests are format-valid opaque fixtures. The three file-content digests
 * are real SHA-256 values of the companion `content` strings, so tests can hash
 * the provided bytes and compare without inventing expectations.
 */
export const B1_DIGESTS = {
  template: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  executable: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  baseManifest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  patch: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  purpose: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
  toolGrant: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
  action: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
  recipient: "sha256:8888888888888888888888888888888888888888888888888888888888888888",
  ticketBody: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
  artifactContent: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sourceLabel: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  nodeArtifact: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  transferBody: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  deniedTransferBody: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  patchGrant: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  tamperedTemplate: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  baseFile: "sha256:23d2a376ce24490fee9d0f34226f120b0646f0e6644049307288f45cc49ebccf",
  patchedFile: "sha256:46bf7b82eb848d6d0764acfb2ac24144578f130b8190b036b3bf3408f26be415",
  concurrentFile: "sha256:b5eab748ca89fdc6c26e116fd63ae6bd5467caa163f2c0031a444f1732934f85",
} as const satisfies Readonly<Record<string, B1Digest>>;

/** Fixed RFC 3339 instants for deterministic ordering. */
export const B1_TIMES = {
  snapshotCreatedAt: "2026-11-22T10:00:00.000Z",
  artifactCreatedAt: "2026-11-22T10:01:00.000Z",
  approvalDecidedAt: "2026-11-22T10:02:00.000Z",
  patchStartedAt: "2026-11-22T10:03:00.000Z",
  operationAuthorizedAt: "2026-11-22T10:04:00.000Z",
  operationDispatchedAt: "2026-11-22T10:04:01.000Z",
  executionStartedAt: "2026-11-22T10:04:02.000Z",
} as const;

export interface B1ResourceBudget {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxReadBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDurationSeconds: number;
  readonly maxConcurrent: number;
  readonly cpuMillicpu: number;
  readonly memoryMb: number;
  readonly processes: number;
}

export interface B1ResourceUsage {
  readonly files: number;
  readonly bytes: number;
  readonly readBytes: number;
  readonly outputBytes: number;
  readonly durationSeconds: number;
  readonly concurrent: number;
  readonly cpuMillicpu: number;
  readonly memoryMb: number;
  readonly processes: number;
}

export const B1_FIXED_TOOL_BUDGET = {
  maxFiles: 2,
  maxBytes: 4096,
  maxReadBytes: 4096,
  maxOutputBytes: 1024,
  maxDurationSeconds: 10,
  maxConcurrent: 1,
  cpuMillicpu: 500,
  memoryMb: 128,
  processes: 4,
} as const satisfies B1ResourceBudget;

export interface B1StringEnumParameter {
  readonly type: "string";
  readonly enum: readonly string[];
  readonly description?: string;
}

export interface B1FixedToolParameterSchema {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, B1StringEnumParameter>>;
}

export interface B1FixedToolTemplate {
  readonly id: string;
  readonly nodeId: string;
  readonly version: number;
  readonly digest: B1Digest;
  readonly displayName: string;
  readonly purpose: string;
  readonly executableDigest: B1Digest;
  readonly parameterSchema: B1FixedToolParameterSchema;
  readonly workingScope: string;
  readonly envAllowlist: readonly string[];
  readonly networkPolicy: "disabled";
  readonly outputLimit: number;
  readonly sideEffectClass: "local_output_only";
  readonly budget: B1ResourceBudget;
}

/**
 * The only B1 template used by allowed/denied invocation fixtures. It has no
 * shell, no extra argv, no undeclared environment, and no network permission.
 */
export const B1_FIXED_TOOL_TEMPLATE = {
  id: B1_IDS.fixedToolTemplate,
  nodeId: B1_IDS.sourceNode,
  version: 1,
  digest: B1_DIGESTS.template,
  displayName: "B1 fixture unit-test runner",
  purpose: "Run one declared local suite through a fixed shell-free executable.",
  executableDigest: B1_DIGESTS.executable,
  parameterSchema: {
    type: "object",
    additionalProperties: false,
    required: ["suite"],
    properties: {
      suite: {
        type: "string",
        enum: ["unit", "integration"],
        description: "A declared suite name, never a command or argument vector.",
      },
    },
  },
  workingScope: "fixture-base-snapshot",
  envAllowlist: [],
  networkPolicy: "disabled",
  outputLimit: 1024,
  sideEffectClass: "local_output_only",
  budget: B1_FIXED_TOOL_BUDGET,
} as const satisfies B1FixedToolTemplate;

export const B1_FIXED_TOOL_ALLOWED_INVOCATIONS = {
  unit: {
    templateId: B1_FIXED_TOOL_TEMPLATE.id,
    templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
    arguments: { suite: "unit" },
  },
  integration: {
    templateId: B1_FIXED_TOOL_TEMPLATE.id,
    templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
    arguments: { suite: "integration" },
  },
} as const satisfies Readonly<Record<string, B1ToolRequestBody>>;

export type B1RejectedToolErrorCode =
  | "invalid_arguments"
  | "invalid_request"
  | "template_digest_mismatch"
  | "network_denied";

export interface B1RejectedInvocationCase {
  readonly caseId: string;
  readonly reason: string;
  readonly expectedErrorCode: B1RejectedToolErrorCode;
  readonly request: B1ToolRequestBody;
}

/**
 * Out-of-bound requests. Every case must be rejected before execution starts,
 * including when the extra field looks like a harmless transport envelope.
 */
export const B1_FIXED_TOOL_REJECTED_INVOCATIONS = {
  shellString: {
    caseId: "shell-string",
    reason: "A parameter value must never be interpreted by a shell.",
    expectedErrorCode: "invalid_arguments",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit; /bin/sh -c id" },
    },
  },
  extraArgument: {
    caseId: "extra-argument",
    reason: "The parameter schema closes the object and defines no reporter option.",
    expectedErrorCode: "invalid_arguments",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit", reporter: "json" },
    },
  },
  commandSubstitution: {
    caseId: "command-substitution",
    reason: "Substitution syntax is not a suite identifier.",
    expectedErrorCode: "invalid_arguments",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit-$(id)" },
    },
  },
  commandChaining: {
    caseId: "command-chaining",
    reason: "Chaining or redirection is never accepted inside a declared value.",
    expectedErrorCode: "invalid_arguments",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit && touch /tmp/b1-escaped" },
    },
  },
  templateDigestMismatch: {
    caseId: "template-digest-mismatch",
    reason: "The request must bind the currently registered template digest.",
    expectedErrorCode: "template_digest_mismatch",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_DIGESTS.tamperedTemplate,
      arguments: { suite: "unit" },
    },
  },
  executableSubstitution: {
    caseId: "executable-substitution",
    reason: "The remote request may not choose an executable or interpreter.",
    expectedErrorCode: "invalid_request",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit" },
      executablePath: "/bin/sh",
    },
  },
  extraArgv: {
    caseId: "extra-argv",
    reason: "No undeclared argv may be appended to the fixed template.",
    expectedErrorCode: "invalid_request",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit" },
      argv: ["-c", "id"],
    },
  },
  hostEnvironment: {
    caseId: "host-environment",
    reason: "The request may not inject environment variables.",
    expectedErrorCode: "invalid_request",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit" },
      environment: {
        PATH: "/usr/local/bin:/usr/bin",
        B1_FIXTURE_CANARY: "test-only-canary-not-a-secret",
      },
    },
  },
  absoluteWorkingDirectory: {
    caseId: "absolute-working-directory",
    reason: "Remote requests use the registered working scope, never a host path.",
    expectedErrorCode: "invalid_request",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit" },
      workingDirectory: "/opt/owner-private",
    },
  },
  networkRequest: {
    caseId: "network-request",
    reason: "B1 fixed tools have no network permission; the endpoint is harness-only.",
    expectedErrorCode: "network_denied",
    request: {
      templateId: B1_FIXED_TOOL_TEMPLATE.id,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      arguments: { suite: "unit" },
      network: "enabled",
    },
  },
} as const satisfies Readonly<Record<string, B1RejectedInvocationCase>>;

export interface B1SandboxMount {
  readonly source: string;
  readonly target: string;
  readonly mode: "ro" | "rw";
}

export interface B1ShellFreeEnvironmentSnapshot {
  readonly label: "first-run" | "second-run";
  readonly shellPath: null;
  readonly shellAvailable: false;
  readonly environment: Readonly<Record<string, string>>;
  readonly envAllowlist: readonly string[];
  readonly hostEnvironmentInherited: false;
  readonly forbiddenHostEnvironmentKeys: readonly string[];
  readonly mounts: readonly B1SandboxMount[];
  readonly writableRoots: readonly string[];
  readonly networkInterfaces: readonly string[];
  readonly hostPidNamespace: false;
  readonly hostIpcNamespace: false;
  readonly dockerSocketPath: null;
  readonly credentialSources: readonly string[];
  readonly processGroupTermination: true;
  readonly residualPathsAfterExit: readonly string[];
}

/**
 * Expected shell-free sandbox state. Every run gets a fresh root; the two
 * snapshots differ only in their run label and writable temporary root.
 */
export const B1_SHELL_FREE_ENVIRONMENT_SNAPSHOT = {
  label: "first-run",
  shellPath: null,
  shellAvailable: false,
  environment: {},
  envAllowlist: [],
  hostEnvironmentInherited: false,
  forbiddenHostEnvironmentKeys: [
    "B1_FIXTURE_CANARY",
    "AWS_SECRET_ACCESS_KEY",
    "OPENAI_API_KEY",
    "DOCKER_HOST",
  ],
  mounts: [
    {
      source: `snapshot:${B1_IDS.baseSnapshot}`,
      target: "/input",
      mode: "ro",
    },
    {
      source: "sandbox:output",
      target: "/output",
      mode: "rw",
    },
  ],
  writableRoots: ["/output", "/tmp/unspool-b1-run-1"],
  networkInterfaces: [],
  hostPidNamespace: false,
  hostIpcNamespace: false,
  dockerSocketPath: null,
  credentialSources: [],
  processGroupTermination: true,
  residualPathsAfterExit: [],
} as const satisfies B1ShellFreeEnvironmentSnapshot;

export const B1_SECOND_RUN_ENVIRONMENT_SNAPSHOT = {
  ...B1_SHELL_FREE_ENVIRONMENT_SNAPSHOT,
  label: "second-run",
  writableRoots: ["/output", "/tmp/unspool-b1-run-2"],
} as const satisfies B1ShellFreeEnvironmentSnapshot;

export interface B1CountableSideEffectEndpoint {
  readonly displayName: string;
  readonly baseUrl: "http://127.0.0.1:43119";
  readonly incrementPath: string;
  readonly countPath: string;
  readonly resetPath: string;
  readonly method: "POST";
  readonly counterKey: string;
  readonly initialCount: 0;
  readonly expectedCounts: {
    readonly beforeExecution: 0;
    readonly afterPreSideEffectKill: 0;
    readonly afterPostSideEffectKill: 1;
    readonly afterReconnectAndReplay: 1;
  };
  readonly idempotencyHeader: string;
  readonly fixtureIdempotencyKey: string;
  readonly requestBodyFields: readonly string[];
  readonly testHarnessOnly: true;
  readonly reachableByB1FixedTools: false;
}

/**
 * Loopback counter owned by the test harness. It is not a network grant and no
 * B1 template may reach it. Tests must assert the counter is never greater than
 * one, including after crash/reconnect/replay scenarios.
 */
export const B1_COUNTABLE_SIDE_EFFECT_ENDPOINT = {
  displayName: "B1 countable side-effect endpoint",
  baseUrl: "http://127.0.0.1:43119",
  incrementPath: "/b1/side-effects/increment",
  countPath: "/b1/side-effects/count",
  resetPath: "/b1/side-effects/reset",
  method: "POST",
  counterKey: "b1-side-effect-count",
  initialCount: 0,
  expectedCounts: {
    beforeExecution: 0,
    afterPreSideEffectKill: 0,
    afterPostSideEffectKill: 1,
    afterReconnectAndReplay: 1,
  },
  idempotencyHeader: "Idempotency-Key",
  fixtureIdempotencyKey: "b1-side-effect-fixture-key",
  requestBodyFields: ["requestId", "executionId"],
  testHarnessOnly: true,
  reachableByB1FixedTools: false,
} as const satisfies B1CountableSideEffectEndpoint;

export interface B1SnapshotEntry {
  readonly entryId: string;
  readonly logicalPath: string;
  readonly type: "regular_file";
  readonly size: number;
  readonly contentDigest: B1Digest;
}

export interface B1SnapshotManifest {
  readonly id: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly rootDigest: B1Digest;
  readonly entries: readonly B1SnapshotEntry[];
  readonly createdAt: string;
  readonly pathVisibility: "authorized_recipients";
  readonly cachePolicy: {
    readonly centralCache: false;
    readonly offlineRead: false;
    readonly retentionSeconds: 0;
  };
  readonly state: "ready";
}

export const B1_BASE_FILE_CONTENT = 'export const fixtureValue = "base";\n';
export const B1_PATCHED_FILE_CONTENT = 'export const fixtureValue = "patched";\n';
export const B1_CONCURRENT_FILE_CONTENT = 'export const fixtureValue = "concurrent";\n';

/**
 * Read-only base snapshot. `B1_DIGESTS.baseFile` is SHA-256 of
 * `B1_BASE_FILE_CONTENT` (36 bytes).
 */
export const B1_BASE_SNAPSHOT = {
  id: B1_IDS.baseSnapshot,
  nodeId: B1_IDS.sourceNode,
  resourceId: B1_IDS.sourceResource,
  rootDigest: B1_DIGESTS.baseManifest,
  entries: [
    {
      entryId: "b1-entry-src-example",
      logicalPath: "src/example.ts",
      type: "regular_file",
      size: 36,
      contentDigest: B1_DIGESTS.baseFile,
    },
  ],
  createdAt: B1_TIMES.snapshotCreatedAt,
  pathVisibility: "authorized_recipients",
  cachePolicy: {
    centralCache: false,
    offlineRead: false,
    retentionSeconds: 0,
  },
  state: "ready",
} as const satisfies B1SnapshotManifest;

export interface B1PatchFileChange {
  readonly path: string;
  readonly changeType: "update";
  readonly baseDigest: B1Digest;
  readonly replacementContent: string;
  readonly replacementDigest: B1Digest;
}

export interface B1PatchProposal {
  readonly id: string;
  readonly nodeId: string;
  readonly baseSnapshotId: string;
  readonly baseManifestDigest: B1Digest;
  readonly fileChanges: readonly B1PatchFileChange[];
  readonly runId: string;
  readonly purposeDigest: B1Digest;
  readonly patchDigest: B1Digest;
  readonly securityLabelId: string;
  readonly state: "proposed";
}

/**
 * Proposed Patch bound to the base snapshot. Generating or reading it grants no
 * write permission; application needs `B1_PATCH_APPLICATION` plus an independent
 * grant and current-file preconditions.
 */
export const B1_PATCH_PROPOSAL = {
  id: B1_IDS.patchProposal,
  nodeId: B1_IDS.sourceNode,
  baseSnapshotId: B1_IDS.baseSnapshot,
  baseManifestDigest: B1_DIGESTS.baseManifest,
  fileChanges: [
    {
      path: "src/example.ts",
      changeType: "update",
      baseDigest: B1_DIGESTS.baseFile,
      replacementContent: B1_PATCHED_FILE_CONTENT,
      replacementDigest: B1_DIGESTS.patchedFile,
    },
  ],
  runId: B1_IDS.sourceRun,
  purposeDigest: B1_DIGESTS.purpose,
  patchDigest: B1_DIGESTS.patch,
  securityLabelId: B1_IDS.sourceSecurityLabel,
  state: "proposed",
} as const satisfies B1PatchProposal;

export interface B1PatchFileResult {
  readonly path: string;
  readonly outcome: "applied" | "conflict" | "skipped";
  readonly resultDigest?: B1Digest;
}

export interface B1PatchApplication {
  readonly id: string;
  readonly patchId: string;
  readonly independentGrantId: string;
  readonly preconditionDigests: readonly B1Digest[];
  readonly journalRef: string;
  readonly resultByFile: readonly B1PatchFileResult[];
  readonly appliedBy: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

/**
 * Independent local application intent. It does not by itself authorize a write
 * and starts with no result; the conflict fixture below is the negative branch.
 */
export const B1_PATCH_APPLICATION = {
  id: B1_IDS.patchApplication,
  patchId: B1_IDS.patchProposal,
  independentGrantId: B1_IDS.patchGrant,
  preconditionDigests: [B1_DIGESTS.baseFile],
  journalRef: "journal://b1/patch-application",
  resultByFile: [],
  appliedBy: B1_IDS.sourceOwner,
  startedAt: B1_TIMES.patchStartedAt,
} as const satisfies B1PatchApplication;

export interface B1PatchConflict {
  readonly patchId: string;
  readonly expectedState: "conflict";
  readonly basePreconditionDigests: readonly B1Digest[];
  readonly currentFileDigests: Readonly<Record<string, B1Digest>>;
  readonly expectedResultByFile: readonly B1PatchFileResult[];
  readonly autoMerge: false;
  readonly expectedWriteCount: 0;
  readonly expectedOutputArtifactVersions: 0;
}

/**
 * Current bytes differ from the base digest. Apply must stop with `conflict`,
 * must not merge, and must produce no file write or new Artifact version.
 */
export const B1_PATCH_CONFLICT = {
  patchId: B1_IDS.patchProposal,
  expectedState: "conflict",
  basePreconditionDigests: [B1_DIGESTS.baseFile],
  currentFileDigests: {
    "src/example.ts": B1_DIGESTS.concurrentFile,
  },
  expectedResultByFile: [
    {
      path: "src/example.ts",
      outcome: "conflict",
    },
  ],
  autoMerge: false,
  expectedWriteCount: 0,
  expectedOutputArtifactVersions: 0,
} as const satisfies B1PatchConflict;

export interface B1ModelRecipient {
  readonly providerId: string;
  readonly modelId: string;
  readonly region: string;
  readonly retentionPolicy: "zero_retention" | "provider_default" | "custom_reviewed";
}

export interface B1CachePolicy {
  readonly centralCache: boolean;
  readonly offlineRead: boolean;
  readonly retentionSeconds: number;
  readonly maxBytes?: number;
}

export interface B1RecipientRules {
  readonly members: readonly string[];
  readonly models: readonly B1ModelRecipient[];
  readonly targetDomains: readonly string[];
  readonly publicTimeline: boolean;
  readonly cache: B1CachePolicy;
}

export interface B1LabelReview {
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly decision: "approved";
  readonly reason: string;
}

export interface B1SecurityLabel {
  readonly id: string;
  readonly version: number;
  readonly purposeRules: readonly string[];
  readonly memberRules: readonly string[];
  readonly modelRecipientRules: readonly B1ModelRecipient[];
  readonly targetDomainRules: readonly string[];
  readonly publicVisibility: boolean;
  readonly cacheAndRetention: B1CachePolicy;
  readonly untrustedContent: boolean;
  readonly reviewHistory: readonly B1LabelReview[];
}

const B1_LABEL_CACHE: B1CachePolicy = {
  centralCache: false,
  offlineRead: false,
  retentionSeconds: 0,
};

/**
 * Source label permits a node-domain transfer but no member/model/public path.
 * The derived label below narrows the target domain to the actual recipient.
 */
export const B1_CROSS_DOMAIN_SOURCE_LABEL = {
  id: B1_IDS.sourceSecurityLabel,
  version: 1,
  purposeRules: ["b1.cross-domain.artifact"],
  memberRules: [],
  modelRecipientRules: [],
  targetDomainRules: [`node:${B1_IDS.recipientNode}`, `node:${B1_IDS.thirdNode}`],
  publicVisibility: false,
  cacheAndRetention: B1_LABEL_CACHE,
  untrustedContent: true,
  reviewHistory: [],
} as const satisfies B1SecurityLabel;

export const B1_CROSS_DOMAIN_DERIVED_LABEL = {
  id: B1_IDS.derivedSecurityLabel,
  version: 2,
  purposeRules: ["b1.cross-domain.artifact"],
  memberRules: [],
  modelRecipientRules: [],
  targetDomainRules: [`node:${B1_IDS.recipientNode}`],
  publicVisibility: false,
  cacheAndRetention: B1_LABEL_CACHE,
  untrustedContent: true,
  reviewHistory: [],
} as const satisfies B1SecurityLabel;

export interface B1CrossDomainRecipient {
  readonly displayName: string;
  readonly destinationKind: "node";
  readonly nodeId: string;
  readonly ownerId: string;
  readonly domainId: string;
  readonly recipientRules: B1RecipientRules;
  readonly requiredApprovals: readonly ("source_owner" | "recipient_owner")[];
}

export const B1_CROSS_DOMAIN_RECIPIENT = {
  displayName: "B1 recipient node B",
  destinationKind: "node",
  nodeId: B1_IDS.recipientNode,
  ownerId: B1_IDS.recipientOwner,
  domainId: `node:${B1_IDS.recipientNode}`,
  recipientRules: {
    members: [],
    models: [],
    targetDomains: [`node:${B1_IDS.recipientNode}`],
    publicTimeline: false,
    cache: B1_LABEL_CACHE,
  },
  requiredApprovals: ["source_owner", "recipient_owner"],
} as const satisfies B1CrossDomainRecipient;

export interface B1NodeArtifact {
  readonly id: string;
  readonly originNodeIds: readonly string[];
  readonly originOwnerIds: readonly string[];
  readonly originGrantDigests: readonly B1Digest[];
  readonly derivedFrom: readonly string[];
  readonly contentDigest: B1Digest;
  readonly securityLabelId: string;
  readonly createdAt: string;
}

export const B1_NODE_ARTIFACT = {
  id: B1_IDS.sourceArtifact,
  originNodeIds: [B1_IDS.sourceNode],
  originOwnerIds: [B1_IDS.sourceOwner],
  originGrantDigests: [B1_DIGESTS.toolGrant],
  derivedFrom: [],
  contentDigest: B1_DIGESTS.artifactContent,
  securityLabelId: B1_IDS.sourceSecurityLabel,
  createdAt: B1_TIMES.artifactCreatedAt,
} as const satisfies B1NodeArtifact;

export interface B1ArtifactVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly blobId: string;
  readonly kind: "reference" | "agent_output" | "node_artifact" | "patch" | "export";
  readonly originType: string;
  readonly originId: string;
  readonly runId?: string;
  readonly attribution: {
    readonly actorId: string;
    readonly displayNameAtTime: string;
    readonly rolesAtTime: readonly string[];
    readonly occurredAt: string;
  };
  readonly securityLabelId: string;
  readonly sourceSummary: string;
}

export const B1_CROSS_DOMAIN_ARTIFACT = {
  id: B1_IDS.artifactVersion,
  artifactId: B1_IDS.sourceArtifact,
  version: 1,
  blobId: B1_IDS.blob,
  kind: "node_artifact",
  originType: "node_artifact",
  originId: B1_IDS.sourceArtifact,
  runId: B1_IDS.sourceRun,
  attribution: {
    actorId: B1_IDS.sourceOwner,
    displayNameAtTime: "B1 fixture source owner",
    rolesAtTime: ["owner"],
    occurredAt: B1_TIMES.artifactCreatedAt,
  },
  securityLabelId: B1_IDS.sourceSecurityLabel,
  sourceSummary: "Node A fixture artifact; untrusted node output pending review.",
} as const satisfies B1ArtifactVersion;

export interface B1TransferApproval {
  readonly approverRole: "source_owner" | "recipient_owner";
  readonly approverId: string;
  readonly decision: "approved";
  readonly decidedAt: string;
}

export const B1_CROSS_DOMAIN_SOURCE_APPROVAL = {
  approverRole: "source_owner",
  approverId: B1_IDS.sourceOwner,
  decision: "approved",
  decidedAt: B1_TIMES.approvalDecidedAt,
} as const satisfies B1TransferApproval;

export const B1_CROSS_DOMAIN_RECIPIENT_APPROVAL = {
  approverRole: "recipient_owner",
  approverId: B1_IDS.recipientOwner,
  decision: "approved",
  decidedAt: B1_TIMES.approvalDecidedAt,
} as const satisfies B1TransferApproval;

export interface B1DataRights {
  readonly modelDisclose: boolean;
  readonly memberDisclose: boolean;
  readonly publicTimeline: boolean;
  readonly domainPropagate: boolean;
  readonly centralCache: boolean;
  readonly offlineRead: boolean;
}

export interface B1CrossDomainTransfer {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly sourceNodeId: string;
  readonly sourceOwnerId: string;
  readonly destinationKind: "node";
  readonly recipient: B1CrossDomainRecipient;
  readonly sourceSecurityLabelId: string;
  readonly derivedSecurityLabelId: string;
  readonly purpose: string;
  readonly purposeDigest: B1Digest;
  readonly requestedRights: B1DataRights;
  readonly approvals: readonly B1TransferApproval[];
  readonly state: "approved";
  readonly expectedDecision: "allowed";
  readonly expectedPayload: {
    readonly artifactVersionId: string;
    readonly contentDigest: B1Digest;
  };
}

/**
 * Positive transfer with both owner approvals and a narrow derived label.
 * There is still no public or model disclosure right.
 */
export const B1_CROSS_DOMAIN_TRANSFER = {
  id: B1_IDS.transfer,
  artifactVersionId: B1_IDS.artifactVersion,
  sourceNodeId: B1_IDS.sourceNode,
  sourceOwnerId: B1_IDS.sourceOwner,
  destinationKind: "node",
  recipient: B1_CROSS_DOMAIN_RECIPIENT,
  sourceSecurityLabelId: B1_IDS.sourceSecurityLabel,
  derivedSecurityLabelId: B1_IDS.derivedSecurityLabel,
  purpose: "B1 fixture cross-domain Artifact transfer",
  purposeDigest: B1_DIGESTS.purpose,
  requestedRights: {
    modelDisclose: false,
    memberDisclose: false,
    publicTimeline: false,
    domainPropagate: true,
    centralCache: false,
    offlineRead: false,
  },
  approvals: [B1_CROSS_DOMAIN_SOURCE_APPROVAL, B1_CROSS_DOMAIN_RECIPIENT_APPROVAL],
  state: "approved",
  expectedDecision: "allowed",
  expectedPayload: {
    artifactVersionId: B1_IDS.artifactVersion,
    contentDigest: B1_DIGESTS.artifactContent,
  },
} as const satisfies B1CrossDomainTransfer;

export interface B1DeniedCrossDomainTransfer {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly recipientNodeId: string;
  readonly sourceSecurityLabelId: string;
  readonly requiredApprovals: readonly ("source_owner" | "recipient_owner")[];
  readonly providedApprovals: readonly B1TransferApproval[];
  readonly expectedDecision: "denied";
  readonly expectedErrorCode: "recipient_approval_required";
  readonly expectedPayloadBytes: 0;
  readonly expectedRecipientArtifactVersions: 0;
  readonly deniedReason: string;
}

export const B1_CROSS_DOMAIN_TRANSFER_MISSING_APPROVAL = {
  id: B1_IDS.deniedTransfer,
  artifactVersionId: B1_IDS.artifactVersion,
  recipientNodeId: B1_IDS.recipientNode,
  sourceSecurityLabelId: B1_IDS.sourceSecurityLabel,
  requiredApprovals: ["source_owner", "recipient_owner"],
  providedApprovals: [B1_CROSS_DOMAIN_SOURCE_APPROVAL],
  expectedDecision: "denied",
  expectedErrorCode: "recipient_approval_required",
  expectedPayloadBytes: 0,
  expectedRecipientArtifactVersions: 0,
  deniedReason: "missing_recipient_owner_approval",
} as const satisfies B1DeniedCrossDomainTransfer;

export interface B1BudgetExhaustionScenario {
  readonly id: string;
  readonly templateId: string;
  readonly phase: "preflight";
  readonly budget: B1ResourceBudget;
  readonly attemptedUsage: B1ResourceUsage;
  readonly exceededLimit: "maxOutputBytes";
  readonly expectedDecision: "rejected";
  readonly expectedHttpStatus: 429;
  readonly expectedErrorCode: "budget_exhausted";
  readonly autoRaiseBudget: false;
  readonly expectedExecutionDispatched: false;
  readonly expectedSideEffectCount: 0;
  readonly expectedResidualPathsAfterExit: readonly string[];
}

/**
 * The acceptable output budget is 1024 bytes; the attempted output is 1025.
 * The request is denied before dispatch and cannot raise its own budget.
 */
export const B1_BUDGET_EXHAUSTION_SCENARIO = {
  id: "b1-budget-exhausted-output",
  templateId: B1_IDS.fixedToolTemplate,
  phase: "preflight",
  budget: B1_FIXED_TOOL_BUDGET,
  attemptedUsage: {
    files: 1,
    bytes: 36,
    readBytes: 36,
    outputBytes: 1025,
    durationSeconds: 2,
    concurrent: 1,
    cpuMillicpu: 250,
    memoryMb: 64,
    processes: 2,
  },
  exceededLimit: "maxOutputBytes",
  expectedDecision: "rejected",
  expectedHttpStatus: 429,
  expectedErrorCode: "budget_exhausted",
  autoRaiseBudget: false,
  expectedExecutionDispatched: false,
  expectedSideEffectCount: 0,
  expectedResidualPathsAfterExit: [],
} as const satisfies B1BudgetExhaustionScenario;

export interface B1NodeOperation {
  readonly id: string;
  readonly requestId: string;
  readonly nodeId: string;
  readonly grantId: string;
  readonly executionId: string;
  readonly kind: "tool.execute";
  readonly state: "authorized" | "dispatched" | "completed" | "outcome_unknown";
  readonly authorizedAt: string;
  readonly dispatchedAt?: string;
  readonly completedAt?: string;
  readonly unknownReason?: string;
  readonly resultDigest?: B1Digest;
}

export interface B1ToolExecution {
  readonly id: string;
  readonly nodeOperationId: string;
  readonly templateDigest: B1Digest;
  readonly canonicalArgs: B1JsonObject;
  readonly resourceBudget: B1ResourceBudget;
  readonly state:
    | "preflight"
    | "waiting_approval"
    | "dispatched"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "outcome_unknown";
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outputArtifactId?: string;
}

export interface B1UnknownOutcomeScenario {
  readonly id: string;
  readonly phase: "before_side_effect" | "after_side_effect_before_receipt";
  readonly operation: B1NodeOperation;
  readonly execution: B1ToolExecution;
  readonly sideEffectCountAtKill: 0 | 1;
  readonly replay: {
    readonly requestId: string;
    readonly nonce: string;
    readonly mode: "status_query_only";
    readonly reexecute: false;
    readonly expectedState: "outcome_unknown";
    readonly expectedSideEffectCount: 0 | 1;
  };
}

export interface B1UnknownOutcomeScenarios {
  readonly beforeSideEffect: B1UnknownOutcomeScenario;
  readonly afterSideEffectBeforeReceipt: B1UnknownOutcomeScenario;
}

/**
 * A dispatched operation with no final receipt is `outcome_unknown`. Replay is
 * a status query with the original request and nonce; it never executes again.
 * The endpoint count must stay at 0 or 1, never 2.
 */
export const B1_UNKNOWN_OUTCOME_SCENARIOS = {
  beforeSideEffect: {
    id: "b1-unknown-before-side-effect",
    phase: "before_side_effect",
    operation: {
      id: B1_IDS.unknownBeforeOperation,
      requestId: B1_IDS.unknownBeforeRequest,
      nodeId: B1_IDS.sourceNode,
      grantId: B1_IDS.toolGrant,
      executionId: B1_IDS.unknownBeforeExecution,
      kind: "tool.execute",
      state: "outcome_unknown",
      authorizedAt: B1_TIMES.operationAuthorizedAt,
      dispatchedAt: B1_TIMES.operationDispatchedAt,
      unknownReason: "node_terminated_after_dispatch_before_side_effect",
    },
    execution: {
      id: B1_IDS.unknownBeforeToolExecution,
      nodeOperationId: B1_IDS.unknownBeforeOperation,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      canonicalArgs: B1_FIXED_TOOL_ALLOWED_INVOCATIONS.unit.arguments,
      resourceBudget: B1_FIXED_TOOL_BUDGET,
      state: "outcome_unknown",
      startedAt: B1_TIMES.executionStartedAt,
    },
    sideEffectCountAtKill: 0,
    replay: {
      requestId: B1_IDS.unknownBeforeRequest,
      nonce: "b1-fixture-nonce-before-side-effect",
      mode: "status_query_only",
      reexecute: false,
      expectedState: "outcome_unknown",
      expectedSideEffectCount: 0,
    },
  },
  afterSideEffectBeforeReceipt: {
    id: "b1-unknown-after-side-effect-before-receipt",
    phase: "after_side_effect_before_receipt",
    operation: {
      id: B1_IDS.unknownAfterOperation,
      requestId: B1_IDS.unknownAfterRequest,
      nodeId: B1_IDS.sourceNode,
      grantId: B1_IDS.toolGrant,
      executionId: B1_IDS.unknownAfterExecution,
      kind: "tool.execute",
      state: "outcome_unknown",
      authorizedAt: B1_TIMES.operationAuthorizedAt,
      dispatchedAt: B1_TIMES.operationDispatchedAt,
      unknownReason: "node_terminated_after_side_effect_before_receipt",
    },
    execution: {
      id: B1_IDS.unknownAfterToolExecution,
      nodeOperationId: B1_IDS.unknownAfterOperation,
      templateDigest: B1_FIXED_TOOL_TEMPLATE.digest,
      canonicalArgs: B1_FIXED_TOOL_ALLOWED_INVOCATIONS.unit.arguments,
      resourceBudget: B1_FIXED_TOOL_BUDGET,
      state: "outcome_unknown",
      startedAt: B1_TIMES.executionStartedAt,
    },
    sideEffectCountAtKill: 1,
    replay: {
      requestId: B1_IDS.unknownAfterRequest,
      nonce: "b1-fixture-nonce-after-side-effect",
      mode: "status_query_only",
      reexecute: false,
      expectedState: "outcome_unknown",
      expectedSideEffectCount: 1,
    },
  },
} as const satisfies B1UnknownOutcomeScenarios;
