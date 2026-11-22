export type { ActionEnvelope } from "../../../../packages/domain/src/action-proposal.js";
export { computeActionDigest } from "../../../../packages/domain/src/action-proposal.js";
export type {
  DecideApprovalInput,
  DecideApprovalResult,
} from "../../../../packages/domain/src/approval-decision.js";
export { decideApproval } from "../../../../packages/domain/src/approval-decision.js";
export {
  DEFAULT_APPROVAL_TTL_MS,
  invalidateApprovalForChangedAction,
  isApprovalExpired,
} from "../../../../packages/domain/src/approval-request.js";
export type {
  CreateApprovalServiceInput,
  CreateApprovalServiceResult,
} from "./service.js";
export { createApprovalRequest } from "./service.js";
