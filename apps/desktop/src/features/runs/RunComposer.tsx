import { useEffect, useId, useRef } from "react";
import type { ComposerMode, RunDetail } from "../../api/types";
import { isRunActive } from "./runState";
import { StopRunDialog } from "./StopRunDialog";

interface RunComposerProps {
  readonly mode: ComposerMode;
  readonly draft: string;
  readonly run: RunDetail | null;
  readonly canStart: boolean;
  readonly canCommand: boolean;
  readonly startBlockedReason: string | null;
  readonly commandBlockedReason: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly feedback: string | null;
  readonly stopConfirm: boolean;
  readonly onModeChange: (mode: ComposerMode) => void;
  readonly onDraftChange: (value: string) => void;
  readonly onStart: (body: string) => void;
  readonly onSteer: (body: string) => void;
  readonly onFollowUp: (body: string) => void;
  readonly onRequestStop: () => void;
  readonly onCancelStop: () => void;
  readonly onConfirmStop: () => void;
}

const MODE_LABELS: Readonly<Record<ComposerMode, string>> = {
  start: "Start",
  steer: "Steer",
  follow_up: "Follow-up",
};

const MODE_HINTS: Readonly<Record<ComposerMode, string>> = {
  start:
    "Start a new Run for this task. An opening instruction is optional because the task goal is already saved.",
  steer: "Redirect the active Run. The Runner records this as a Run command.",
  follow_up: "Queue an instruction for the active Run after its current work.",
};

export function RunComposer({
  mode,
  draft,
  run,
  canStart,
  canCommand,
  startBlockedReason,
  commandBlockedReason,
  busy,
  error,
  feedback,
  stopConfirm,
  onModeChange,
  onDraftChange,
  onStart,
  onSteer,
  onFollowUp,
  onRequestStop,
  onCancelStop,
  onConfirmStop,
}: RunComposerProps) {
  const textId = useId();
  const stopTitleId = useId();
  const stopRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const active = isRunActive(run?.state ?? null);
  const stopping = run?.state === "stopping";
  const commandMode = mode === "start" ? null : mode;
  const commandDisabled =
    commandMode !== null && (draft.trim().length === 0 || !canCommand || busy);
  const stopDisabled = !active || stopping || run?.operatorEpoch === null || busy;

  useEffect(() => {
    if (stopConfirm) {
      wasConfirming.current = true;
      confirmRef.current?.focus();
      return;
    }
    if (wasConfirming.current) {
      wasConfirming.current = false;
      stopRef.current?.focus();
    }
  }, [stopConfirm]);

  function handleSubmit() {
    if (mode === "start") {
      if (canStart && !busy) {
        onStart(draft);
      }
      return;
    }
    if (draft.trim().length === 0 || !canCommand || busy) {
      return;
    }
    if (mode === "steer") {
      onSteer(draft);
    } else {
      onFollowUp(draft);
    }
  }

  return (
    <section className="panel composer" data-testid="run-composer" aria-labelledby="composer-title">
      <h2 id="composer-title" className="sr-only">
        Direct the Agent
      </h2>
      <div className="composer__topline">
        <fieldset className="mode-tabs">
          <legend className="sr-only">Run command mode</legend>
          {(Object.keys(MODE_LABELS) as ComposerMode[]).map((candidate) => {
            const disabled = candidate !== "start" && run === null;
            return (
              <button
                key={candidate}
                type="button"
                className="mode-tabs__button"
                data-testid={`composer-mode-${candidate.replace("_", "-")}`}
                aria-pressed={mode === candidate}
                onClick={() => onModeChange(candidate)}
                disabled={disabled || busy}
              >
                {MODE_LABELS[candidate]}
              </button>
            );
          })}
        </fieldset>
        {active ? (
          <button
            ref={stopRef}
            type="button"
            className="button button--danger"
            data-testid="stop-run"
            onClick={onRequestStop}
            disabled={stopDisabled}
          >
            {stopping ? "Stopping…" : "Stop run"}
          </button>
        ) : null}
      </div>

      <div className="field composer__field">
        <label className="sr-only" htmlFor={textId}>
          {mode === "start"
            ? "Opening instruction (optional)"
            : mode === "steer"
              ? "Steer instruction"
              : "Follow-up instruction"}
        </label>
        <textarea
          id={textId}
          data-testid="composer-input"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          rows={2}
          placeholder={
            mode === "start"
              ? "Add anything the saved goal does not cover."
              : mode === "steer"
                ? "Describe the correction the active Run should take."
                : "Describe work to queue after the current instruction."
          }
          disabled={busy || (commandMode !== null && !canCommand)}
        />
      </div>

      {run !== null && mode === "start" && active ? (
        <p className="notice notice--warning" role="status">
          A Run is already active. Stop it or wait for it to settle before starting another Run.
        </p>
      ) : null}
      {mode === "start" && startBlockedReason !== null && !active ? (
        <p className="notice notice--warning" role="status">
          {startBlockedReason}
        </p>
      ) : null}
      {commandMode !== null && commandBlockedReason !== null ? (
        <p className="notice notice--warning" role="status">
          {commandBlockedReason}
        </p>
      ) : null}

      <div className="composer__actions">
        <p className="sr-only">{MODE_HINTS[mode]}</p>
        {mode === "start" ? (
          <button
            type="button"
            className="button button--primary"
            data-testid="start-run"
            onClick={handleSubmit}
            disabled={!canStart || busy}
          >
            {busy ? "Working…" : run !== null && !active ? "Start another Run" : "Start run"}
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            data-testid="send-command"
            onClick={handleSubmit}
            disabled={commandDisabled}
          >
            {busy ? "Sending…" : mode === "steer" ? "Send steer" : "Queue follow-up"}
          </button>
        )}
      </div>

      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {feedback !== null ? (
        <p className="notice notice--success" role="status">
          {feedback}
        </p>
      ) : null}

      {stopConfirm && active ? (
        <StopRunDialog
          titleId={stopTitleId}
          busy={busy}
          confirmRef={confirmRef}
          onCancel={onCancelStop}
          onConfirm={onConfirmStop}
        />
      ) : null}
    </section>
  );
}
