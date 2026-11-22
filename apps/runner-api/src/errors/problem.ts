import type { FastifyReply } from "fastify";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export type ProblemCode =
  | "invalid_request"
  | "unauthenticated"
  | "permission_denied"
  | "grant_required"
  | "not_found"
  | "revision_conflict"
  | "operator_changed"
  | "task_active"
  | "approval_required"
  | "approval_invalid"
  | "outcome_unknown"
  | "workspace_archived"
  | "grant_inactive"
  | "evidence_incomplete"
  | "node_unavailable"
  | "budget_exhausted"
  | "internal_error"
  | "runner_unavailable";

export interface ProblemObject {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly instance?: string;
  readonly retryable: boolean;
  readonly revision?: number;
}

export interface ProblemOptions {
  readonly detail?: string;
  readonly instance?: string;
  readonly retryable?: boolean;
  readonly revision?: number;
}

interface ProblemDefinition {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly retryable: boolean;
}

const defineProblem = (
  code: ProblemCode,
  status: number,
  title: string,
  detail: string,
  retryable = false,
): ProblemDefinition => ({
  type: `https://unspool.dev/problems/${code.replaceAll("_", "-")}`,
  title,
  status,
  detail,
  retryable,
});

export const PROBLEM_DEFINITIONS = {
  invalid_request: defineProblem(
    "invalid_request",
    400,
    "Invalid request",
    "The request did not satisfy the API contract.",
  ),
  unauthenticated: defineProblem(
    "unauthenticated",
    401,
    "Unauthenticated",
    "Authentication is required to perform this action.",
  ),
  permission_denied: defineProblem(
    "permission_denied",
    403,
    "Permission denied",
    "The current principal is not permitted to perform this action.",
  ),
  grant_required: defineProblem(
    "grant_required",
    403,
    "Grant required",
    "A matching owner grant is required for this action.",
  ),
  not_found: defineProblem("not_found", 404, "Not Found", "The requested resource was not found."),
  revision_conflict: defineProblem(
    "revision_conflict",
    409,
    "Revision conflict",
    "The resource changed since the supplied revision was read.",
  ),
  operator_changed: defineProblem(
    "operator_changed",
    409,
    "Operator changed",
    "The active workspace operator changed before this action was applied.",
  ),
  task_active: defineProblem(
    "task_active",
    409,
    "Task active",
    "The workspace already has an active task.",
  ),
  approval_required: defineProblem(
    "approval_required",
    409,
    "Approval required",
    "This action requires an independent approval.",
  ),
  approval_invalid: defineProblem(
    "approval_invalid",
    409,
    "Approval invalid",
    "The approval is no longer valid for this action.",
  ),
  outcome_unknown: defineProblem(
    "outcome_unknown",
    409,
    "Outcome unknown",
    "The outcome of the existing operation is unknown and must not be replayed automatically.",
  ),
  workspace_archived: defineProblem(
    "workspace_archived",
    409,
    "Workspace archived",
    "The workspace is read-only because it has been archived.",
  ),
  grant_inactive: defineProblem(
    "grant_inactive",
    410,
    "Grant inactive",
    "The grant was revoked, expired, or exhausted.",
  ),
  evidence_incomplete: defineProblem(
    "evidence_incomplete",
    422,
    "Evidence incomplete",
    "Required evidence is missing, invalid, or awaiting review.",
  ),
  node_unavailable: defineProblem(
    "node_unavailable",
    423,
    "Node unavailable",
    "The contributing node is offline, paused, isolated, revoked, or incompatible.",
    true,
  ),
  budget_exhausted: defineProblem(
    "budget_exhausted",
    429,
    "Budget exhausted",
    "A file, execution, concurrency, time, or output budget was exhausted.",
  ),
  internal_error: defineProblem(
    "internal_error",
    500,
    "Internal Server Error",
    "The request failed unexpectedly.",
  ),
  runner_unavailable: defineProblem(
    "runner_unavailable",
    503,
    "Runner unavailable",
    "The Runner or a required dependency is unavailable.",
    true,
  ),
} satisfies Record<ProblemCode, ProblemDefinition>;

export const PROBLEM_CODES = Object.freeze(Object.keys(PROBLEM_DEFINITIONS) as ProblemCode[]);

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(password|passwd|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]*/g;
const POSIX_PATH_PATTERN = /(?<![\w:.])\/(?:[\w.@-]+\/){2,}[\w.@-]+/g;
const CONTROL_CHARACTER_PATTERN = /[\r\n\t]+/g;

/**
 * Removes details that must never cross an authorization boundary: internal
 * identifiers, filesystem paths, credentials, and stack-trace line breaks.
 */
export function redactProblemText(value: string): string {
  const redacted = value
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(UUID_PATTERN, "[redacted-id]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(WINDOWS_PATH_PATTERN, "[redacted-path]")
    .replace(POSIX_PATH_PATTERN, "[redacted-path]")
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .trim();

  return redacted.length > 500 ? `${redacted.slice(0, 497)}...` : redacted;
}

export function createProblem(code: ProblemCode, options: ProblemOptions = {}): ProblemObject {
  const definition = PROBLEM_DEFINITIONS[code];

  return {
    type: definition.type,
    title: definition.title,
    status: definition.status,
    code,
    detail: options.detail === undefined ? definition.detail : redactProblemText(options.detail),
    ...(options.instance === undefined ? {} : { instance: redactProblemText(options.instance) }),
    retryable: options.retryable ?? definition.retryable,
    ...(options.revision === undefined ? {} : { revision: options.revision }),
  };
}

export function notFoundProblem(): ProblemObject {
  return createProblem("not_found");
}

export class ProblemError extends Error {
  readonly problem: ProblemObject;

  constructor(code: ProblemCode, options: ProblemOptions = {}) {
    const problem = createProblem(code, options);
    super(problem.detail);
    this.name = "ProblemError";
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }

  get code(): ProblemCode {
    return this.problem.code;
  }
}

/**
 * Converts any thrown value into a response-safe problem. Unrecognized errors
 * deliberately lose their message, stack, and any embedded request data.
 */
export function problemFromError(
  error: unknown,
  options: Pick<ProblemOptions, "instance" | "retryable"> = {},
): ProblemObject {
  if (error instanceof ProblemError) {
    return error.problem;
  }
  return createProblem("internal_error", options);
}

export const mapErrorToProblem = problemFromError;

export function isProblemObject(value: unknown): value is ProblemObject {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ProblemObject>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.detail === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

export function sendProblem(
  reply: FastifyReply,
  codeOrProblem: ProblemCode | ProblemObject,
  options: ProblemOptions = {},
): FastifyReply {
  const problem =
    typeof codeOrProblem === "string" ? createProblem(codeOrProblem, options) : codeOrProblem;

  return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}
