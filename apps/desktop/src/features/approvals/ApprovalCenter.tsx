import { useCallback, useEffect, useMemo, useState } from "react";
import { toolKindForName } from "../../api/runnerClient";
import type { ApprovalState, ApprovalView, RunnerClient } from "../../api/types";
import { ApprovalDetails } from "./ApprovalDetails";

export type ApprovalCenterClient = Pick<RunnerClient, "listApprovals" | "decideApproval">;

export interface ApprovalCenterProps {
  readonly client: ApprovalCenterClient;
  readonly workspaceId?: string | undefined;
  readonly selectedApprovalId?: string | null | undefined;
  readonly currentOperatorId?: string | undefined;
  readonly refreshToken?: number | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onSelectApproval?: ((approval: ApprovalView | null) => void) | undefined;
  readonly onDecision?: ((approval: ApprovalView) => void) | undefined;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return String(cause);
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

export function ApprovalCenter({
  client,
  workspaceId,
  selectedApprovalId,
  currentOperatorId,
  refreshToken,
  readOnly = false,
  onSelectApproval,
  onDecision,
}: ApprovalCenterProps) {
  const [approvals, setApprovals] = useState<readonly ApprovalView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const { listApprovals } = client;
  const controlled = selectedApprovalId !== undefined;

  useEffect(() => {
    void workspaceId;
    void refreshToken;
    void reloadNonce;
    let active = true;
    setLoading(true);
    setError(null);
    void listApprovals()
      .then((items) => {
        if (active) {
          setApprovals(items);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [listApprovals, workspaceId, refreshToken, reloadNonce]);

  const visibleApprovals = useMemo(
    () =>
      approvals.filter(
        (approval) => workspaceId === undefined || approval.workspaceId === workspaceId,
      ),
    [approvals, workspaceId],
  );

  useEffect(() => {
    if (controlled) {
      return;
    }
    if (visibleApprovals.length === 0) {
      if (internalSelectedId !== null) {
        setInternalSelectedId(null);
      }
      return;
    }
    if (
      internalSelectedId !== null &&
      visibleApprovals.some((approval) => approval.id === internalSelectedId)
    ) {
      return;
    }
    const preferred =
      visibleApprovals.find((approval) => approval.state === "pending") ?? visibleApprovals[0];
    if (preferred === undefined) {
      return;
    }
    setInternalSelectedId(preferred.id);
    onSelectApproval?.(preferred);
  }, [controlled, visibleApprovals, internalSelectedId, onSelectApproval]);

  const selectedId = controlled ? selectedApprovalId : internalSelectedId;
  const selectedApproval =
    selectedId === null
      ? null
      : (visibleApprovals.find((approval) => approval.id === selectedId) ?? null);

  const handleSelect = useCallback(
    (approval: ApprovalView) => {
      if (!controlled) {
        setInternalSelectedId(approval.id);
      }
      onSelectApproval?.(approval);
    },
    [controlled, onSelectApproval],
  );

  const handleDecided = useCallback(
    (decided: ApprovalView) => {
      setApprovals((current) =>
        current.map((approval) => (approval.id === decided.id ? decided : approval)),
      );
      onDecision?.(decided);
    },
    [onDecision],
  );

  return (
    <section
      className="approval-center"
      data-testid="approval-center"
      aria-labelledby="approval-center-title"
    >
      <header className="approval-center__header">
        <div>
          <p className="approval-center__eyebrow">Risk boundary</p>
          <h2 id="approval-center-title">Approvals</h2>
          <p>
            High-risk actions wait here. Opening an approval never executes the action; only an
            eligible decision can release a single-use permit.
          </p>
        </div>
        <button
          type="button"
          data-testid="refresh-approvals"
          disabled={loading}
          onClick={() => setReloadNonce((value) => value + 1)}
        >
          {loading ? "Refreshing…" : "Refresh approvals"}
        </button>
      </header>

      {error !== null ? (
        <p className="approval-center__error" data-testid="approval-list-error" role="alert">
          Approvals could not be loaded: {error}
        </p>
      ) : null}

      {loading && visibleApprovals.length === 0 ? (
        <p data-testid="approval-list-loading" role="status">
          Loading approvals…
        </p>
      ) : null}

      {!loading && error === null && visibleApprovals.length === 0 ? (
        <p className="approval-center__empty" data-testid="approval-empty">
          No approvals are waiting for this workspace.
        </p>
      ) : null}

      {visibleApprovals.length > 0 ? (
        <ul className="approval-center__list" aria-label="Approval requests">
          {visibleApprovals.map((approval) => {
            const isSelected = selectedApproval?.id === approval.id;
            return (
              <li key={approval.id}>
                <button
                  type="button"
                  data-testid="approval-item"
                  data-state={approval.state}
                  data-tool-kind={toolKindForName(approval.actionProposal.toolName)}
                  aria-pressed={isSelected}
                  className={
                    isSelected
                      ? "approval-center__item approval-center__item--selected"
                      : "approval-center__item"
                  }
                  onClick={() => handleSelect(approval)}
                >
                  <span className="approval-center__item-tool">
                    {approval.actionProposal.toolName}
                  </span>
                  <span className="approval-center__item-state">
                    {approvalStateLabel(approval.state)}
                  </span>
                  <span className="approval-center__item-purpose">
                    {approval.actionProposal.purpose.trim().length > 0
                      ? approval.actionProposal.purpose
                      : "No purpose reported."}
                  </span>
                  <span className="approval-center__item-requester">
                    Requested by {approval.requesterId}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selectedApproval !== null ? (
        <ApprovalDetails
          approval={selectedApproval}
          client={client}
          currentOperatorId={currentOperatorId}
          readOnly={readOnly}
          onDecided={handleDecided}
        />
      ) : null}
    </section>
  );
}
