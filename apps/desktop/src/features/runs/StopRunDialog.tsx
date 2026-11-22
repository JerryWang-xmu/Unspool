import type { Ref } from "react";

export interface StopRunDialogProps {
  readonly titleId: string;
  readonly busy: boolean;
  readonly confirmRef?: Ref<HTMLButtonElement>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function StopRunDialog({
  titleId,
  busy,
  confirmRef,
  onCancel,
  onConfirm,
}: StopRunDialogProps) {
  return (
    <div
      className="confirm-box"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-detail`}
      data-testid="stop-run-dialog"
    >
      <h3 id={titleId}>Stop this Run?</h3>
      <p id={`${titleId}-detail`}>
        Stopping ends the current execution but keeps task history, queued items, and artifacts.
        Queued instructions are withheld, never released automatically. The final state appears only
        after the Runner confirms it.
      </p>
      <div className="button-row">
        <button
          ref={confirmRef}
          type="button"
          className="button button--danger"
          data-testid="confirm-stop"
          onClick={onConfirm}
          disabled={busy}
        >
          Confirm stop
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="cancel-stop"
          onClick={onCancel}
          disabled={busy}
        >
          Keep running
        </button>
      </div>
    </div>
  );
}
