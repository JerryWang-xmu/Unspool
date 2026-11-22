import { useEffect, useRef, useState } from "react";
import type { CollaborationClient } from "../../api/collaborationTypes";
import type { ModelProfileSummary, RunnerSummary, WorkspaceDetail } from "../../api/types";

export interface StartRunDisclosureProps {
  readonly client: Pick<CollaborationClient, "listContextItems">;
  readonly workspace: WorkspaceDetail;
  readonly runner: RunnerSummary | null;
  readonly profile: ModelProfileSummary | null;
  readonly busy: boolean;
  readonly canConfirm: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function StartRunDisclosure({
  client,
  workspace,
  runner,
  profile,
  busy,
  canConfirm,
  error: startError,
  onCancel,
  onConfirm,
}: StartRunDisclosureProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<
    readonly {
      id: string;
      currentVersion: {
        id: string;
        title: string;
        agentExposure: string;
        memberVisibility: string;
      };
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setContext([]);
    setError(null);
    setContextLoading(true);
    void client
      .listContextItems(workspace.id)
      .then((items) => {
        if (!active) return;
        setContext(items);
        setContextLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setContextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, workspace.id]);
  return (
    <dialog
      ref={dialogRef}
      data-testid="start-run-disclosure"
      aria-labelledby="start-disclosure-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="start-disclosure-title">Confirm task scope before execution</h2>
      <p>No Run or Agent invocation is created until you confirm this exact scope.</p>
      <dl>
        <div>
          <dt>Goal</dt>
          <dd data-testid="disclosure-goal">{workspace.goal}</dd>
        </div>
        <div>
          <dt>Completion criteria</dt>
          <dd data-testid="disclosure-criteria">{workspace.completionCriteria}</dd>
        </div>
        <div>
          <dt>Runner</dt>
          <dd data-testid="disclosure-runner">
            {runner?.name ?? workspace.runnerId ?? "Not reported"}
          </dd>
        </div>
        <div>
          <dt>Agent configuration</dt>
          <dd data-testid="disclosure-profile">
            {profile === null ? workspace.agentProfileId : `${profile.provider}/${profile.model}`}
          </dd>
        </div>
        <div>
          <dt>Operator epoch</dt>
          <dd>{workspace.currentOperator?.operatorEpoch ?? "Not reported"}</dd>
        </div>
      </dl>
      <section aria-labelledby="disclosure-context-title">
        <h3 id="disclosure-context-title">Actual context scope</h3>
        {contextLoading ? <p role="status">Loading the actual context scope…</p> : null}
        {error === null ? null : <p role="alert">{error}</p>}
        <ul data-testid="disclosure-context">
          {context.map((item) => {
            const provided = item.currentVersion.agentExposure === "provide_next_run";
            return (
              <li
                key={item.currentVersion.id}
                data-testid="disclosure-context-item"
                data-provided={provided}
              >
                <span>{item.currentVersion.title}</span> <code>{item.currentVersion.id}</code>{" "}
                <strong>{provided ? "Provided on next Run" : "Excluded from Agent"}</strong>
              </li>
            );
          })}
        </ul>
        {!contextLoading && context.length === 0 && error === null ? (
          <p>No saved context versions will be supplied.</p>
        ) : null}
      </section>
      {startError === null ? null : (
        <p className="notice notice--error" role="alert" data-testid="start-run-error">
          {startError}
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="button button--ghost"
          data-testid="cancel-start-run"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel without starting
        </button>
        <button
          type="button"
          className="button button--primary"
          data-testid="confirm-start-run"
          disabled={busy || contextLoading || error !== null || !canConfirm}
          onClick={onConfirm}
        >
          Confirm and start Run
        </button>
      </div>
    </dialog>
  );
}
