import type { TimelineEvent, WorkspaceDetail } from "./types";

export type WorkspaceRole = "owner" | "operator" | "contributor" | "observer";

export interface TeamMember {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly teamRoles: readonly string[];
  readonly status: "active" | "disabled";
  readonly effectiveStatus?: string;
  readonly expiresAt?: string | null;
  readonly revision: number;
}

export interface WorkspaceMember {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly canApprove: boolean;
  readonly canReview: boolean;
  readonly joinedAt: string;
  readonly leftAt?: string | null;
}

export interface ContextVersionInput {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly sourceRefs?: readonly string[];
  readonly memberVisibility: "members" | "private";
  readonly agentExposure: "not_provided" | "pending_operator" | "provide_next_run";
}

export interface ContextVersion extends ContextVersionInput {
  readonly id: string;
  readonly contextItemId: string;
  readonly version: number;
  readonly attribution?: Readonly<Record<string, unknown>>;
  readonly supersedesId?: string | null;
}

export interface ContextItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: string;
  readonly currentVersionId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly removedAt?: string | null;
  readonly revision: number;
  readonly currentVersion: ContextVersion;
  readonly versions: readonly ContextVersion[];
}

export interface CollaborationInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: "discussion" | "suggestion" | "agent_instruction" | string;
  readonly body: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly references: readonly string[];
  readonly status?: "pending" | "adopted" | "edited_adopted" | "ignored" | null;
  readonly suggestedBy?: string;
  readonly decidedBy?: string | null;
  readonly editedBody?: string | null;
  readonly resultingInputId?: string | null;
  readonly decidedAt?: string | null;
}

export interface SharePreview {
  readonly id: string;
  readonly sourceWorkspaceId: string;
  readonly selectedRecordIds: readonly string[];
  readonly excludedCategories: readonly string[];
  readonly createdBy: string;
  readonly expiresAt: string;
}

export interface CreateSharedWorkspaceInput {
  readonly name: string;
  readonly teamId: string;
  readonly runnerId: string;
  readonly agentProfileId: string;
  readonly goal?: string;
  readonly completionCriteria?: string;
}

export interface CollaborationClient {
  readonly baseUrl: string;
  getWorkspace(workspaceId: string): Promise<WorkspaceDetail>;
  createSharedWorkspace(input: CreateSharedWorkspaceInput): Promise<WorkspaceDetail>;
  updateWorkspace(
    workspaceId: string,
    expectedRevision: number,
    input: { name?: string; goal?: string; completionCriteria?: string },
  ): Promise<WorkspaceDetail>;
  listTeamMembers(teamId: string): Promise<readonly TeamMember[]>;
  inviteWorkspaceMembers(
    workspaceId: string,
    members: readonly {
      userId: string;
      role: WorkspaceRole;
      canApprove?: boolean;
      canReview?: boolean;
    }[],
  ): Promise<readonly WorkspaceMember[]>;
  listContextItems(workspaceId: string): Promise<readonly ContextItem[]>;
  createContextItem(
    workspaceId: string,
    input: ContextVersionInput,
  ): Promise<{ item: ContextItem; version: ContextVersion }>;
  appendContextVersion(
    workspaceId: string,
    contextItemId: string,
    expectedRevision: number,
    input: ContextVersionInput,
  ): Promise<{ item: ContextItem; version: ContextVersion }>;
  postDiscussion(workspaceId: string, body: string): Promise<CollaborationInput>;
  postSuggestion(workspaceId: string, body: string): Promise<CollaborationInput>;
  decideSuggestion(
    workspaceId: string,
    suggestionId: string,
    decision: "adopted" | "edited_adopted" | "ignored",
    editedBody?: string,
  ): Promise<CollaborationInput>;
  postDirectInstruction(workspaceId: string, body: string): Promise<CollaborationInput>;
  createSharePreview(
    workspaceId: string,
    selectedRecordIds: readonly string[],
  ): Promise<SharePreview>;
  convertPersonalTaskToShared(
    workspaceId: string,
    input: {
      sharePreviewId: string;
      teamId: string;
      members: readonly {
        userId: string;
        role: WorkspaceRole;
        canApprove?: boolean;
        canReview?: boolean;
      }[];
    },
  ): Promise<WorkspaceDetail>;
  subscribeWorkspaceEvents(
    workspaceId: string,
    afterSequence: number,
    handlers: { onEvent(event: TimelineEvent): void; onOpen(): void; onError(): void },
  ): () => void;
}
