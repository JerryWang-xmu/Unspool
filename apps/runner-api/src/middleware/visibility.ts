import {
  type AuthorizableRecord,
  type AuthorizationAction,
  type AuthorizationDecision,
  createVisibilityPolicy,
  type VisibilityContext,
  type VisibilityPolicy,
} from "../../../../packages/domain/src/authorization.js";
import { createProblem, notFoundProblem, type ProblemObject } from "../errors/problem.js";

export interface VisibilityGuard {
  readonly policy: VisibilityPolicy;
  readonly canRead: (record: AuthorizableRecord) => boolean;
  readonly filter: <T extends AuthorizableRecord>(records: readonly T[]) => T[];
  readonly filterQueries: <T extends AuthorizableRecord>(records: readonly T[]) => T[];
  readonly filterEvents: <T extends AuthorizableRecord>(records: readonly T[]) => T[];
  readonly filterDownloads: <T extends AuthorizableRecord>(records: readonly T[]) => T[];
  readonly filterExports: <T extends AuthorizableRecord>(records: readonly T[]) => T[];
  readonly authorize: (
    action: AuthorizationAction,
    record: AuthorizableRecord,
  ) => AuthorizationDecision;
  readonly requireReadable: <T extends AuthorizableRecord>(record: T) => T;
  readonly requireAction: <T extends AuthorizableRecord>(
    action: AuthorizationAction,
    record: T,
  ) => T;
  readonly problemFor: (
    action: AuthorizationAction,
    record: AuthorizableRecord,
  ) => ProblemObject | null;
  readonly redactProblem: (
    action: AuthorizationAction,
    record: AuthorizableRecord,
    problem: ProblemObject,
  ) => ProblemObject;
}

/**
 * Errors raised at the visibility boundary are safe to send as-is. Objects the
 * caller may not discover always collapse to a non-disclosing 404.
 */
export class VisibilityError extends Error {
  readonly problem: ProblemObject;

  constructor(problem: ProblemObject) {
    super(problem.detail);
    this.name = "VisibilityError";
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }
}

export class ResourceNotFoundError extends VisibilityError {
  constructor() {
    super(notFoundProblem());
    this.name = "ResourceNotFoundError";
  }
}

const denialProblem = (decision: AuthorizationDecision): ProblemObject => {
  if (decision.allowed) {
    return notFoundProblem();
  }

  switch (decision.reason) {
    case "workspace_archived":
      return createProblem("workspace_archived");
    case "read_only_role":
    case "not_content_owner":
    case "missing_permission":
      return createProblem("permission_denied");
    case "unsupported_action":
      return createProblem("invalid_request");
    case "no_identity":
    case "not_visible":
      return notFoundProblem();
  }
};

export function createVisibilityGuard(context: VisibilityContext): VisibilityGuard {
  const policy = createVisibilityPolicy(context);

  const canRead = (record: AuthorizableRecord): boolean => policy.canRead(record);

  const filter = <T extends AuthorizableRecord>(records: readonly T[]): T[] =>
    policy.filter(records);

  const filterWithAction = <T extends AuthorizableRecord>(
    action: AuthorizationAction,
    records: readonly T[],
  ): T[] => records.filter((record) => policy.authorize(action, record).allowed);

  const requireReadable = <T extends AuthorizableRecord>(record: T): T => {
    if (!canRead(record)) {
      throw new ResourceNotFoundError();
    }
    return record;
  };

  const problemFor = (
    action: AuthorizationAction,
    record: AuthorizableRecord,
  ): ProblemObject | null => {
    const decision = policy.authorize(action, record);
    if (decision.allowed) {
      return null;
    }
    if (!canRead(record)) {
      return notFoundProblem();
    }
    return denialProblem(decision);
  };

  const requireAction = <T extends AuthorizableRecord>(
    action: AuthorizationAction,
    record: T,
  ): T => {
    const problem = problemFor(action, record);
    if (problem !== null) {
      throw new VisibilityError(problem);
    }
    return record;
  };

  return {
    policy,
    canRead,
    filter,
    filterQueries: filter,
    filterEvents: filter,
    filterDownloads: <T extends AuthorizableRecord>(records: readonly T[]): T[] =>
      filterWithAction("download", records),
    filterExports: <T extends AuthorizableRecord>(records: readonly T[]): T[] =>
      filterWithAction("export", records),
    authorize: policy.authorize,
    requireReadable,
    requireAction,
    problemFor,
    redactProblem: (action, record, problem) => problemFor(action, record) ?? problem,
  };
}

export function filterVisibleRecords<T extends AuthorizableRecord>(
  context: VisibilityContext,
  records: readonly T[],
): T[] {
  return createVisibilityGuard(context).filter(records);
}

export function requireVisibleRecord<T extends AuthorizableRecord>(
  context: VisibilityContext,
  record: T,
): T {
  return createVisibilityGuard(context).requireReadable(record);
}

export function visibilityProblemFor(
  context: VisibilityContext,
  action: AuthorizationAction,
  record: AuthorizableRecord,
): ProblemObject | null {
  return createVisibilityGuard(context).problemFor(action, record);
}
