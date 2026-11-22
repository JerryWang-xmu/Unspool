import { useEffect, useState } from "react";
import { toolKindForName } from "../../api/runnerClient";
import type { ApprovalState, ApprovalView, RunnerClient } from "../../api/types";

export type ApprovalDetailsClient = Pick<RunnerClient, "decideApproval">;

export interface ApprovalDetailsProps {
  readonly approval: ApprovalView;
  readonly client: ApprovalDetailsClient;
  readonly currentOperatorId?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onDecided?: ((approval: ApprovalView) => void) | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}

interface DecisionFeedback {
  readonly kind: "info" | "error";
  readonly text: string;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return String(cause);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function textOrFallback(value: string | undefined, fallback: string): string {
  return value !== undefined && value.trim().length > 0 ? value : fallback;
}

function formatTimestamp(value: string | null | undefined): string {
  if (value === undefined || value === null || value.trim().length === 0) {
    return "Not recorded";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function approvalStateLabel(state: ApprovalState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "invalidated":
      return "Invalidated";
    case "unknown":
      return "Unknown";
    default:
      return "Unknown";
  }
}

const SENSITIVE_ARG_KEY =
  /(secret|token|password|passphrase|credential|api[-_]?key|authorization|cookie|private[-_]?key)/i;

function formatDisplayArg(key: string, value: unknown): string {
  if (SENSITIVE_ARG_KEY.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function ApprovalDetails({
  approval,
  client,
  currentOperatorId,
  readOnly = false,
  onDecided,
  onError,
}: ApprovalDetailsProps) {
  const [decidedApproval, setDecidedApproval] = useState<ApprovalView | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [feedback, setFeedback] = useState<DecisionFeedback | null>(null);
  const [exceptionAcknowledged, setExceptionAcknowledged] = useState(false);
  const [exceptionUsed, setExceptionUsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void approval.id;
    setDecidedApproval(null);
    setRejectReason("");
    setConfirmingReject(false);
    setBusy(null);
    setFeedback(null);
    setExceptionAcknowledged(false);
    setExceptionUsed(false);
    setNow(Date.now());
  }, [approval.id]);

  const current =
    decidedApproval !== null && decidedApproval.id === approval.id ? decidedApproval : approval;

  useEffect(() => {
    if (current.state !== "pending") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [current.state]);

  const policy = current.requiredApproverPolicy;
  const approverIds = stringList(policy.approverIds);
  const allowSelfApproval = policy.allowRequesterSelfApproval === true;
  const exception = isRecord(policy.singleUserException) ? policy.singleUserException : null;
  const exceptionEnabled = exception !== null && exception.enabled === true;
  const exceptionApprovedBy = exception === null ? undefined : nonEmptyString(exception.approvedBy);
  const exceptionReason = exception === null ? undefined : nonEmptyString(exception.reason);
  const isRequester = currentOperatorId !== undefined && currentOperatorId === current.requesterId;
  const selfApprovalBlocked = isRequester && !allowSelfApproval && !exceptionEnabled;
  const requiresException = isRequester && !allowSelfApproval && exceptionEnabled;

  const expiryTime = current.expiresAt === null ? null : Date.parse(current.expiresAt);
  const timedOut =
    current.state === "pending" &&
    expiryTime !== null &&
    Number.isFinite(expiryTime) &&
    expiryTime <= now;
  const expired = current.state === "expired" || timedOut;
  const invalidated = current.state === "invalidated";
  const displayedState: ApprovalState =
    timedOut && current.state === "pending" ? "expired" : current.state;

  const canReject = current.state === "pending" && !expired && busy === null;
  const canApprove =
    current.state === "pending" &&
    !expired &&
    !selfApprovalBlocked &&
    (!requiresException || exceptionAcknowledged) &&
    busy === null;
  const canConfirmReject = canReject && rejectReason.trim().length > 0;

  const displayArgs = Object.entries(current.actionProposal.displayArgs);
  const secretRefs = current.actionProposal.secretRefs;
  const toolKind = toolKindForName(current.actionProposal.toolName);

  async function decide(decision: "approved" | "rejected"): Promise<void> {
    if (busy !== null) {
      return;
    }
    if (decision === "approved" && !canApprove) {
      return;
    }
    if (decision === "rejected" && !canConfirmReject) {
      return;
    }

    const reason = rejectReason.trim();
    setBusy(decision);
    setFeedback(null);

    let decided: ApprovalView;
    try {
      decided = await client.decideApproval(
        current.id,
        decision,
        current.actionProposal.actionDigest,
        decision === "rejected" ? reason : undefined,
      );
    } catch (cause) {
      const message = errorMessage(cause);
      setFeedback({ kind: "error", text: message });
      onError?.(message);
      setBusy(null);
      return;
    }

    setDecidedApproval(decided);
    setConfirmingReject(false);
    if (decision === "approved" && requiresException && exceptionAcknowledged) {
      setExceptionUsed(true);
    }

    if (decision === "rejected") {
      setFeedback({ kind: "info", text: `Approval rejected. Reason: ${reason}` });
    } else if (decided.state === "approved") {
      setFeedback({
        kind: "info",
        text: "Approval approved. The Run may now consume one single-use permit.",
      });
    } else {
      setFeedback({ kind: "info", text: `Approval state is now ${decided.state}.` });
    }

    setBusy(null);
    try {
      onDecided?.(decided);
    } catch {
      // A host callback must not turn a persisted decision into a UI error.
    }
  }

  return (
    <section
      className="approval-details"
      data-testid="approval-details"
      data-state={displayedState}
      aria-labelledby="approval-details-title"
    >
      <header className="approval-details__header">
        <div>
          <p className="approval-details__eyebrow">High-risk action</p>
          <h2 id="approval-details-title">Approval details</h2>
        </div>
        <div className="approval-details__state">
          <span>State</span>
          <strong data-testid="approval-state" data-state={displayedState}>
            {approvalStateLabel(displayedState)}
          </strong>
        </div>
      </header>

      {invalidated ? (
        <div className="approval-details__warning" data-testid="approval-invalidated" role="alert">
          <strong>The approved content or scope changed.</strong>
          <p data-testid="reapproval-required">
            Reapproval is required before this action can execute. The previous decision cannot
            authorize the current proposal.
          </p>
        </div>
      ) : null}

      {expired ? (
        <div
          className="approval-details__warning"
          data-testid="approval-expired-banner"
          role="alert"
        >
          <strong>This approval has expired.</strong>
          <p data-testid="late-approval-explanation">
            An expired or late approval has no executable path. Request a new approval after
            confirming the action is still needed.
          </p>
        </div>
      ) : null}

      <dl className="approval-details__facts">
        <div>
          <dt>Requester</dt>
          <dd data-testid="approval-requester">
            {textOrFallback(current.requesterId, "Unknown requester")}
          </dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd data-testid="approval-purpose">
            {textOrFallback(current.actionProposal.purpose, "No purpose was reported.")}
          </dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd data-testid="approval-impact">
            {textOrFallback(current.actionProposal.impact, "No impact was reported.")}
          </dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd data-testid="approval-risk">
            {textOrFallback(current.actionProposal.risk, "No risk was reported.")}
          </dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd data-testid="approval-expires-at" data-expired={expired ? "true" : "false"}>
            {formatTimestamp(current.expiresAt)}
          </dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>{textOrFallback(current.runId, "No Run reference reported.")}</dd>
        </div>
      </dl>

      <section className="approval-details__section" aria-labelledby="approval-action-heading">
        <h3 id="approval-action-heading">Requested action</h3>
        <div
          className="approval-details__action"
          data-testid="approval-action"
          data-tool-kind={toolKind}
        >
          <p>
            <strong>{current.actionProposal.toolName}</strong>
          </p>
          {displayArgs.length === 0 ? (
            <p>No display arguments were reported.</p>
          ) : (
            <dl>
              {displayArgs.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    <pre>{formatDisplayArg(key, value)}</pre>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="approval-details__digest">
            Action digest: <code>{current.actionProposal.actionDigest}</code>
          </p>
        </div>

        <div className="approval-details__secrets">
          <h4>Secret references</h4>
          <div data-testid="approval-secret-refs">
            {secretRefs.length === 0 ? (
              <p>No secret references were reported.</p>
            ) : (
              <ul>
                {[...new Set(secretRefs)].map((reference) => (
                  <li key={reference}>{reference}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="approval-details__section" aria-labelledby="approval-policy-heading">
        <h3 id="approval-policy-heading">Approval policy</h3>
        <dl data-testid="approval-policy">
          <div>
            <dt>Required approvers</dt>
            <dd>
              {approverIds.length === 0
                ? "Any eligible independent approver"
                : approverIds.join(", ")}
            </dd>
          </div>
          <div>
            <dt>Requester self-approval</dt>
            <dd>{allowSelfApproval ? "Allowed by policy" : "Not allowed by policy"}</dd>
          </div>
          <div>
            <dt>Single-user exception</dt>
            <dd>
              {exceptionEnabled
                ? `Enabled${exceptionApprovedBy === undefined ? "" : ` by ${exceptionApprovedBy}`}${
                    exceptionReason === undefined ? "" : `: ${exceptionReason}`
                  }`
                : "Not enabled"}
            </dd>
          </div>
          <div>
            <dt>Policy revision</dt>
            <dd>{current.policyRevision === null ? "Not reported" : current.policyRevision}</dd>
          </div>
        </dl>
      </section>

      {readOnly ? (
        <p className="approval-details__read-only" data-testid="approval-read-only">
          Only an eligible approver can decide this request.
        </p>
      ) : (
        <section
          className="approval-details__section"
          data-testid="approval-decision-controls"
          aria-labelledby="approval-decision-heading"
        >
          <h3 id="approval-decision-heading">Decision</h3>

          {selfApprovalBlocked ? (
            <div
              className="approval-details__warning"
              data-testid="self-approval-blocked"
              role="alert"
            >
              <strong>Self-approval is blocked.</strong>
              <p data-testid="self-approval-explanation">
                You cannot approve your own high-risk action. An eligible independent approver must
                decide this request.
              </p>
            </div>
          ) : null}

          {requiresException ? (
            <div className="approval-details__exception">
              <label>
                <input
                  type="checkbox"
                  data-testid="single-user-exception-toggle"
                  checked={exceptionAcknowledged}
                  onChange={(event) => setExceptionAcknowledged(event.target.checked)}
                />{" "}
                Use the single-user exception for this self-approval
              </label>
              {exceptionAcknowledged ? (
                <div
                  className="approval-details__warning"
                  data-testid="single-user-exception-warning"
                  role="alert"
                >
                  This self-approval uses the single-user exception and will be recorded in the
                  audit trail.
                </div>
              ) : null}
            </div>
          ) : null}

          {isRequester && allowSelfApproval ? (
            <p className="approval-details__note">
              Policy allows the requester to decide this action. The decision is still recorded.
            </p>
          ) : null}

          <label className="approval-details__reason" htmlFor="approval-reject-reason">
            Reason for rejection (required)
          </label>
          <textarea
            id="approval-reject-reason"
            data-testid="reject-reason"
            value={rejectReason}
            rows={3}
            disabled={!canReject}
            onChange={(event) => setRejectReason(event.target.value)}
          />

          <div className="approval-details__buttons">
            <button
              type="button"
              data-testid="approve-approval"
              disabled={!canApprove}
              onClick={() => void decide("approved")}
            >
              {busy === "approved" ? "Approving…" : "Approve action"}
            </button>
            <button
              type="button"
              data-testid="reject-approval"
              disabled={!canReject}
              onClick={() => setConfirmingReject(true)}
            >
              {busy === "rejected" ? "Rejecting…" : "Reject…"}
            </button>
          </div>

          {confirmingReject ? (
            <fieldset className="approval-details__confirm" aria-label="Confirm rejection">
              <p>Reject this action? The Agent will be told it was not approved.</p>
              <button
                type="button"
                data-testid="confirm-reject"
                disabled={!canConfirmReject}
                onClick={() => void decide("rejected")}
              >
                Confirm rejection
              </button>
              <button
                type="button"
                data-testid="cancel-reject"
                disabled={busy !== null}
                onClick={() => setConfirmingReject(false)}
              >
                Cancel
              </button>
            </fieldset>
          ) : null}

          <p
            className={`approval-details__feedback approval-details__feedback--${
              feedback?.kind ?? "info"
            }`}
            data-testid="approval-feedback"
            role={feedback?.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback?.text ?? "No decision has been recorded in this view."}
          </p>

          {exceptionUsed && current.state === "approved" ? (
            <p className="approval-details__audit" data-testid="self-approval-audit-record">
              Single-user exception self-approval recorded in the audit trail.
            </p>
          ) : null}
        </section>
      )}
    </section>
  );
}
