export type MemberRole = "owner" | "operator" | "contributor" | "observer";

export type WorkspaceKind = "personal" | "shared";

export type WorkspaceStatus = "draft" | "active" | "archived";

export type UserStatus = "active" | "disabled";

export type VisibilityKind = "workspace_members" | "private";

export type AuthorizationAction = "read" | "write" | "approve" | "review" | "download" | "export";

export interface WorkspaceVisibility {
  readonly kind: "workspace_members";
  readonly roles?: readonly MemberRole[];
}

export interface PrivateVisibility {
  readonly kind: "private";
  readonly actorIds: readonly string[];
}

export type RecordVisibility = WorkspaceVisibility | PrivateVisibility;

/**
 * The authorization-relevant shape shared by queries, events, downloads, and
 * exports. Records without an explicit visibility are workspace-member only.
 */
export interface AuthorizableRecord {
  readonly id?: string;
  readonly actorId?: string;
  readonly visibility?: RecordVisibility | null;
}

export interface WorkspaceMembership {
  readonly userId: string;
  readonly role: MemberRole;
  readonly canApprove?: boolean;
  readonly canReview?: boolean;
  readonly joinedAt?: string | null;
  readonly leftAt?: string | null;
  readonly expiresAt?: string | null;
  readonly status?: "active" | "invited" | "expired" | "disabled";
}

export interface WorkspaceReference {
  readonly id: string;
  readonly kind: WorkspaceKind;
  readonly ownerId: string;
  readonly status: WorkspaceStatus;
}

export interface VisibilityUser {
  readonly id: string;
  readonly status: UserStatus;
  readonly authVersion?: number;
}

export interface VisibilityContext {
  readonly now: string;
  readonly workspace: WorkspaceReference;
  readonly membership: WorkspaceMembership | null;
  readonly user?: VisibilityUser;
}

export type DenialReason =
  | "no_identity"
  | "not_visible"
  | "workspace_archived"
  | "read_only_role"
  | "not_content_owner"
  | "missing_permission"
  | "unsupported_action";

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenialReason };

export interface NotFoundErrorBody {
  readonly type: string;
  readonly title: string;
  readonly status: 404;
  readonly code: "not_found";
  readonly detail: string;
  readonly retryable: false;
}

export interface VisibilityPolicy {
  readonly canRead: (record: AuthorizableRecord) => boolean;
  readonly filter: <T extends AuthorizableRecord>(records: readonly T[]) => T[];
  readonly authorize: (
    action: AuthorizationAction,
    record: AuthorizableRecord,
  ) => AuthorizationDecision;
  readonly notFoundError: () => NotFoundErrorBody;
}

interface ActiveActor {
  readonly userId: string;
  readonly role: MemberRole;
  readonly canApprove: boolean;
  readonly canReview: boolean;
}

const ALLOWED: AuthorizationDecision = { allowed: true };

const deny = (reason: DenialReason): AuthorizationDecision => ({ allowed: false, reason });

const notFoundError = (): NotFoundErrorBody => ({
  type: "https://unspool.dev/problems/not-found",
  title: "Not Found",
  status: 404,
  code: "not_found",
  detail: "The requested resource was not found.",
  retryable: false,
});

const parseInstant = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const isAtOrBefore = (instant: string | null | undefined, nowMs: number): boolean => {
  if (instant === null || instant === undefined) {
    return false;
  }
  const parsed = parseInstant(instant);
  return Number.isFinite(parsed) && parsed <= nowMs;
};

const isAfter = (instant: string | null | undefined, nowMs: number): boolean => {
  if (instant === null || instant === undefined) {
    return false;
  }
  const parsed = parseInstant(instant);
  return !Number.isFinite(parsed) || parsed > nowMs;
};

const isMembershipActive = (membership: WorkspaceMembership, nowMs: number): boolean => {
  if (membership.status !== undefined && membership.status !== "active") {
    return false;
  }
  if (isAtOrBefore(membership.leftAt, nowMs)) {
    return false;
  }
  if (isAtOrBefore(membership.expiresAt, nowMs)) {
    return false;
  }
  if (isAfter(membership.joinedAt, nowMs)) {
    return false;
  }
  return true;
};

const resolveActor = (context: VisibilityContext): ActiveActor | null => {
  const { membership, user, workspace } = context;

  if (user !== undefined && user.status !== "active") {
    return null;
  }

  if (user !== undefined && membership !== null && user.id !== membership.userId) {
    return null;
  }

  let userId: string | undefined;
  let membershipRole: MemberRole | undefined;
  let membershipActive = false;

  if (membership !== null) {
    if (!isMembershipActive(membership, parseInstant(context.now))) {
      return null;
    }
    userId = membership.userId;
    membershipRole = membership.role;
    membershipActive = true;
  } else {
    userId = user?.id;
  }

  if (userId === undefined) {
    if (workspace.kind !== "personal") {
      return null;
    }
    // A personal task is implicitly owned by its creator even without a
    // WorkspaceMember row.
    userId = workspace.ownerId;
  }

  if (workspace.kind === "personal" && userId !== workspace.ownerId) {
    return null;
  }

  const isOwner = userId === workspace.ownerId || membershipRole === "owner";

  if (!membershipActive && !isOwner) {
    return null;
  }

  if (!membershipActive && workspace.kind !== "personal" && user === undefined) {
    return null;
  }

  return {
    userId,
    role: isOwner ? "owner" : (membershipRole ?? "observer"),
    canApprove: isOwner || membership?.canApprove === true,
    canReview: isOwner || membership?.canReview === true,
  };
};

const canReadRecord = (actor: ActiveActor | null, record: AuthorizableRecord): boolean => {
  if (actor === null) {
    return false;
  }

  const visibility = record.visibility;
  if (visibility === null || visibility === undefined || visibility.kind === "workspace_members") {
    const roles = visibility?.roles;
    return roles === undefined || roles.includes(actor.role);
  }

  if (visibility.kind === "private") {
    return Array.isArray(visibility.actorIds) && visibility.actorIds.includes(actor.userId);
  }

  return false;
};

const isArchivedReadOnlyAction = (action: AuthorizationAction): boolean =>
  action === "write" || action === "approve" || action === "review";

export function createVisibilityPolicy(context: VisibilityContext): VisibilityPolicy {
  const actor = resolveActor(context);
  const archived = context.workspace.status === "archived";

  const canRead = (record: AuthorizableRecord): boolean => canReadRecord(actor, record);

  const authorize = (
    action: AuthorizationAction,
    record: AuthorizableRecord,
  ): AuthorizationDecision => {
    if (!canRead(record)) {
      return deny("not_visible");
    }

    if (archived && isArchivedReadOnlyAction(action)) {
      return deny("workspace_archived");
    }

    switch (action) {
      case "read":
      case "download":
      case "export":
        return ALLOWED;
      case "write": {
        if (actor === null) {
          return deny("no_identity");
        }
        if (actor.role === "observer") {
          return deny("read_only_role");
        }
        if (actor.role === "owner" || actor.role === "operator") {
          return ALLOWED;
        }
        if (record.actorId === actor.userId) {
          return ALLOWED;
        }
        return deny("not_content_owner");
      }
      case "approve": {
        if (actor === null) {
          return deny("no_identity");
        }
        if (actor.role === "observer") {
          return deny("read_only_role");
        }
        return actor.canApprove ? ALLOWED : deny("missing_permission");
      }
      case "review": {
        if (actor === null) {
          return deny("no_identity");
        }
        if (actor.role === "observer") {
          return deny("read_only_role");
        }
        return actor.canReview ? ALLOWED : deny("missing_permission");
      }
      default:
        return deny("unsupported_action");
    }
  };

  return {
    canRead,
    filter: <T extends AuthorizableRecord>(records: readonly T[]): T[] =>
      records.filter((record) => canRead(record)),
    authorize,
    notFoundError,
  };
}
