export type ConnectionState = "connecting" | "available" | "degraded" | "offline";

export interface HostEnvironment {
  readonly appVersion: string;
  readonly platform: string;
  readonly mode: "tauri" | "browser";
  readonly note?: string;
}

export interface RunnerHealth {
  readonly status: "ok" | "degraded";
  readonly service: string;
  readonly runnerVersion?: string;
  readonly schemaVersion?: number;
  readonly capabilities: readonly string[];
  readonly supportedPlatforms: readonly string[];
  readonly supportState?: string;
  readonly maxUploadBytes?: number;
  readonly maxActiveRunsPerWorkspace?: number;
  readonly maxWorkers?: number;
  readonly dependencies: readonly {
    readonly name: string;
    readonly status: "ok" | "degraded" | "unavailable";
  }[];
}

export interface RunnerSummary {
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  readonly status: string;
  readonly version?: string;
  readonly capabilities: readonly string[];
  readonly maxUploadBytes?: number;
  readonly supportState?: string;
  readonly lastHeartbeatAt?: string;
}

export interface ModelProfileSummary {
  readonly id: string;
  readonly runnerId?: string;
  readonly provider: string;
  readonly model: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly reasoningOptions?: Readonly<Record<string, unknown>>;
}

export interface PersonalTaskSummary {
  readonly id: string;
  readonly name: string;
  readonly goal?: string;
  readonly completionCriteria?: string;
  readonly kind: "personal" | "shared";
  readonly status: "draft" | "active" | "archived" | "unknown";
  readonly runnerId?: string;
  readonly agentProfileId?: string;
  readonly teamId?: string;
  readonly revision?: number;
  readonly updatedAt?: string;
}

export interface OperatorRef {
  readonly operatorId: string;
  readonly operatorEpoch: number;
}

export interface WorkspaceDetail extends PersonalTaskSummary {
  readonly currentOperator?: OperatorRef;
}

export type RunState =
  | "created"
  | "running"
  | "waiting_approval"
  | "stopping"
  | "technical_complete"
  | "failed"
  | "cancelled"
  | "needs_confirmation"
  | "unknown";

export interface RunSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId?: string;
  readonly sessionId?: string;
  readonly state: RunState;
  readonly operatorEpoch: number | null;
  readonly contextSnapshotId?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly result?: string;
  readonly unknownReason?: string;
  readonly lastKnownCheckpoint?: Readonly<Record<string, unknown>>;
}

export interface TimelineActor {
  readonly actorId?: string;
  readonly displayNameAtTime?: string;
  readonly rolesAtTime?: readonly string[];
}

export interface TimelineEvent {
  readonly id: string;
  readonly type: string;
  readonly sequence?: number;
  readonly occurredAt?: string;
  readonly runId?: string;
  readonly actor?: TimelineActor;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ToolKind = "read" | "write" | "execute" | "other";

export interface ToolCallView {
  readonly id: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly kind: ToolKind;
  readonly state: string;
  readonly approvalRequired: boolean;
  readonly displayArgs?: unknown;
  readonly output?: string;
  readonly startedAt?: string;
  readonly updatedAt?: string;
}

export interface RunDetail extends RunSummary {
  readonly toolCalls: readonly ToolCallView[];
  readonly initialEvents: readonly TimelineEvent[];
  readonly permitEvents: readonly TimelineEvent[];
}

export interface ActionProposalView {
  readonly toolName: string;
  readonly displayArgs: Readonly<Record<string, unknown>>;
  readonly secretRefs: readonly string[];
  readonly actionDigest: string;
  readonly purpose: string;
  readonly impact: string;
  readonly risk: string;
  readonly runId?: string;
  readonly workspaceId?: string;
}

export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "invalidated"
  | "unknown";

export interface ApprovalView {
  readonly id: string;
  readonly actionProposal: ActionProposalView;
  readonly requesterId: string;
  readonly requiredApproverPolicy: Readonly<Record<string, unknown>>;
  readonly policyRevision: number | null;
  readonly state: ApprovalState;
  readonly expiresAt: string | null;
  readonly createdAt?: string;
  readonly decidedBy?: string;
  readonly reason?: string;
  readonly runId?: string;
  readonly workspaceId?: string;
}

export type ArtifactAvailability = "available" | "missing" | "unknown";

export interface ArtifactView {
  readonly id: string;
  readonly artifactId?: string;
  readonly artifactVersionId?: string;
  readonly name: string;
  readonly version: number;
  readonly mediaType: string;
  readonly size: number | null;
  readonly sha256?: string;
  readonly kind: string;
  readonly sourceSummary?: string;
  readonly runId?: string;
  readonly availability: ArtifactAvailability;
  readonly createdAt?: string;
}

export interface UsageSummary {
  readonly available: boolean;
  readonly reason?: string;
  readonly provider?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costAmount?: number;
  readonly costCurrency?: string;
  readonly reliability?: string;
}

export type BackupState = "unavailable" | "never_run" | "running" | "succeeded" | "failed";

export interface BackupStatus {
  readonly state: BackupState;
  readonly message?: string;
  readonly lastBackupAt?: string;
  readonly manifestId?: string;
  readonly manifestDigest?: string;
}

export interface CreatePersonalTaskInput {
  readonly name: string;
  readonly goal: string;
  readonly completionCriteria?: string;
  readonly runnerId: string;
  readonly agentProfileId: string;
}

export interface StartRunInput {
  readonly body?: string;
  readonly contextSnapshotId?: string;
}

export type ComposerMode = "start" | "steer" | "follow_up";

export type ApprovalDecision = "approved" | "rejected";

export interface RunnerClient {
  readonly baseUrl: string;
  getHealth(): Promise<RunnerHealth>;
  listRunners(): Promise<readonly RunnerSummary[]>;
  listModelProfiles(runnerId: string): Promise<readonly ModelProfileSummary[]>;
  listPersonalTasks(): Promise<readonly PersonalTaskSummary[]>;
  getPersonalTask(workspaceId: string): Promise<WorkspaceDetail>;
  createPersonalTask(input: CreatePersonalTaskInput): Promise<WorkspaceDetail>;
  listRuns(workspaceId: string): Promise<readonly RunSummary[]>;
  getRun(workspaceId: string, runId: string): Promise<RunDetail>;
  startRun(
    workspaceId: string,
    input: StartRunInput,
    operatorEpoch: number,
  ): Promise<RunSummary | null>;
  steerRun(workspaceId: string, runId: string, body: string, operatorEpoch: number): Promise<void>;
  queueFollowUp(
    workspaceId: string,
    runId: string,
    body: string,
    operatorEpoch: number,
  ): Promise<void>;
  stopRun(workspaceId: string, runId: string, operatorEpoch: number): Promise<void>;
  assessRunResult(
    workspaceId: string,
    runId: string,
    result: "complete" | "partial" | "incomplete" | "failed" | "cancelled",
    reason?: string,
  ): Promise<void>;
  subscribeWorkspaceEvents?(
    workspaceId: string,
    afterSequence: number,
    handlers: {
      readonly onEvent: (event: TimelineEvent) => void;
      readonly onOpen: () => void;
      readonly onError: () => void;
    },
  ): () => void;
  listApprovals(): Promise<readonly ApprovalView[]>;
  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    actionDigest: string,
    reason?: string,
  ): Promise<ApprovalView>;
  listArtifacts(workspaceId: string): Promise<readonly ArtifactView[]>;
  uploadArtifact(
    workspaceId: string,
    file: File,
    onPhase?: (phase: "hashing" | "uploading") => void,
  ): Promise<ArtifactView>;
  downloadArtifact(workspaceId: string, artifact: ArtifactView): Promise<Blob>;
  getUsage?(workspaceId: string, runId: string): Promise<UsageSummary>;
  getBackupStatus?(): Promise<BackupStatus>;
  runBackup?(): Promise<BackupStatus>;
}

export type CommandPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "hashing" }
  | { readonly phase: "uploading"; readonly fileName: string }
  | { readonly phase: "done"; readonly message: string }
  | { readonly phase: "error"; readonly message: string };

export type DownloadPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "downloading"; readonly artifactId: string }
  | { readonly phase: "done"; readonly message: string }
  | { readonly phase: "error"; readonly message: string };
