import { useState } from "react";
import type { HandoffSummary } from "../../../../../packages/domain/src/handoff-summary";

export interface HandoffInvitationProps {
  readonly invitation: {
    id: string;
    recipientId: string;
    status: string;
    baseRevision: number;
    latestRevision?: number;
  };
  readonly summary: HandoffSummary;
  readonly currentActorId: string;
  readonly busy?: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onAccept: () => Promise<void>;
  readonly onReject: (reason: string) => Promise<void>;
}

export function HandoffInvitation({
  invitation,
  summary,
  currentActorId,
  busy = false,
  onRefresh,
  onAccept,
  onReject,
}: HandoffInvitationProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stale =
    invitation.latestRevision !== undefined && invitation.latestRevision > invitation.baseRevision;
  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <section className="panel" data-testid="handoff-invitation" aria-labelledby="handoff-title">
      <h2 id="handoff-title">Responsibility handoff</h2>
      <p>
        Recipient: {invitation.recipientId}
        {currentActorId === invitation.recipientId ? " (you)" : ""}
      </p>
      <dl className="workspace-meta">
        <div>
          <dt>Goal</dt>
          <dd>{summary.goal}</dd>
        </div>
        <div>
          <dt>Criteria</dt>
          <dd>{summary.criteria}</dd>
        </div>
        <div>
          <dt>Run state</dt>
          <dd>{summary.runState}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{summary.revision}</dd>
        </div>
        <div>
          <dt>Decisions</dt>
          <dd>{summary.decisions.length}</dd>
        </div>
        <div>
          <dt>Pending approvals</dt>
          <dd>{summary.pendingApprovalIds.length}</dd>
        </div>
        <div>
          <dt>Queued instructions</dt>
          <dd>{summary.queueIds.length}</dd>
        </div>
        <div>
          <dt>Artifacts</dt>
          <dd>{summary.artifactIds.length}</dd>
        </div>
        <div>
          <dt>Blockers</dt>
          <dd>{summary.blockers.length}</dd>
        </div>
      </dl>
      {stale ? (
        <p className="notice notice--warning" role="alert">
          Background changed. Refresh and review the latest revision before accepting.
        </p>
      ) : null}
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="button-row">
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => {
            void run(onRefresh);
          }}
        >
          Refresh background
        </button>
        <button
          type="button"
          className="button button--primary"
          data-testid="accept-handoff"
          disabled={busy || stale}
          onClick={() => {
            void run(onAccept);
          }}
        >
          Accept responsibility
        </button>
      </div>
      <label htmlFor="handoff-reject-reason">
        Rejection reason
        <textarea
          id="handoff-reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="button button--danger"
        data-testid="reject-handoff"
        disabled={busy || reason.trim().length === 0}
        onClick={() => {
          void run(() => onReject(reason.trim()));
        }}
      >
        Reject handoff
      </button>
    </section>
  );
}
