import { useState } from "react";

export interface PreparationExitDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (retainPrivate: boolean) => Promise<void>;
}

export function PreparationExitDialog({ open, onCancel, onConfirm }: PreparationExitDialogProps) {
  const [retainPrivate, setRetainPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div
      className="confirm-box"
      role="alertdialog"
      aria-labelledby="preparation-exit-title"
      data-testid="preparation-exit-dialog"
    >
      <h2 id="preparation-exit-title">Leave private preparation?</h2>
      <p>
        Choose what remains private. Published clarifications stay visible; unpublished questions
        and answers never become public by exiting.
      </p>
      <label>
        <input
          type="checkbox"
          checked={retainPrivate}
          onChange={(event) => setRetainPrivate(event.target.checked)}
        />{" "}
        Retain private preparation records locally
      </label>
      <div className="button-row">
        <button type="button" className="button button--ghost" disabled={busy} onClick={onCancel}>
          Continue preparing
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm(retainPrivate).finally(() => setBusy(false));
          }}
        >
          Leave preparation
        </button>
      </div>
    </div>
  );
}
