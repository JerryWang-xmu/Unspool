import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { CreatePersonalTaskInput, ModelProfileSummary, RunnerSummary } from "../../api/types";

interface PersonalTaskEditorProps {
  readonly runners: readonly RunnerSummary[];
  readonly modelProfiles: readonly ModelProfileSummary[];
  readonly selectedRunnerId: string;
  readonly selectedProfileId: string;
  readonly profileLoading: boolean;
  readonly runnersError: string | null;
  readonly profileError: string | null;
  readonly creating: boolean;
  readonly createError: string | null;
  readonly runnerAvailable: boolean;
  readonly onRunnerChange: (runnerId: string) => void;
  readonly onProfileChange: (profileId: string) => void;
  readonly onCreate: (input: CreatePersonalTaskInput) => void;
  readonly onCancel: () => void;
}

function profileLabel(profile: ModelProfileSummary): string {
  if (profile.label === profile.model) {
    return `${profile.label} (${profile.provider})`;
  }
  return `${profile.label} - ${profile.provider}/${profile.model}`;
}

export function PersonalTaskEditor({
  runners,
  modelProfiles,
  selectedRunnerId,
  selectedProfileId,
  profileLoading,
  runnersError,
  profileError,
  creating,
  createError,
  runnerAvailable,
  onRunnerChange,
  onProfileChange,
  onCreate,
  onCancel,
}: PersonalTaskEditorProps) {
  const nameId = useId();
  const goalId = useId();
  const runnerId = useId();
  const profileId = useId();
  const criteriaId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const selectedProfile = modelProfiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const canSubmit =
    !creating &&
    runnerAvailable &&
    runners.length > 0 &&
    modelProfiles.length > 0 &&
    selectedRunnerId.length > 0 &&
    selectedProfileId.length > 0 &&
    name.trim().length > 0 &&
    goal.trim().length > 0 &&
    criteria.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setValidationError("Enter a task name before creating the personal task.");
      nameRef.current?.focus();
      return;
    }
    if (goal.trim().length === 0 || criteria.trim().length === 0) {
      setValidationError("Enter both the task goal and observable completion criteria.");
      return;
    }
    if (selectedRunnerId.length === 0) {
      setValidationError("Select an authorized Runner.");
      return;
    }
    if (selectedProfileId.length === 0) {
      setValidationError("Select an enabled model profile.");
      return;
    }
    setValidationError(null);
    onCreate({
      name: trimmedName,
      goal: goal.trim(),
      runnerId: selectedRunnerId,
      agentProfileId: selectedProfileId,
      completionCriteria: criteria.trim(),
    });
  }

  const blockingMessage = !runnerAvailable
    ? "The Runner is offline. Creation will stay disabled until it reconnects."
    : runners.length === 0
      ? "No authorized Runner is available to this account."
      : modelProfiles.length === 0 && !profileLoading
        ? "The selected Runner has no enabled model profile."
        : null;

  return (
    <section
      className="panel editor"
      data-testid="personal-task-editor"
      aria-labelledby="editor-title"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">New personal task</p>
          <h2 id="editor-title">Create a focused Agent task</h2>
          <p className="panel__hint">
            The task is personal from the start. Nothing here requires a Team or a shared workspace.
          </p>
        </div>
        <button
          type="button"
          className="button button--ghost"
          onClick={onCancel}
          disabled={creating}
        >
          Cancel
        </button>
      </div>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={nameId}>Task name</label>
          <input
            ref={nameRef}
            id={nameId}
            data-testid="personal-task-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={50}
            required
            aria-invalid={validationError !== null && name.trim().length === 0}
            aria-describedby={`${nameId}-hint`}
          />
          <p id={`${nameId}-hint`} className="field__hint">
            Up to 50 characters. This label is used in personal history and the recent-task card.
          </p>
        </div>

        <div className="field">
          <label htmlFor={goalId}>Task goal</label>
          <textarea
            id={goalId}
            data-testid="personal-task-goal"
            value={goal}
            onChange={(event) => setGoal(event.currentTarget.value)}
            rows={5}
            placeholder="Describe the outcome the Agent should produce and the work that is in scope."
            aria-describedby={`${goalId}-hint`}
          />
          <p id={`${goalId}-hint`} className="field__hint">
            The goal is saved with the task and can be used as the starting instruction for the
            first Run.
          </p>
        </div>

        <div className="field">
          <label htmlFor={criteriaId}>Completion criteria</label>
          <textarea
            id={criteriaId}
            data-testid="personal-task-completion-criteria"
            required
            value={criteria}
            onChange={(event) => setCriteria(event.currentTarget.value)}
            rows={2}
            placeholder="How will you judge whether the work is complete?"
          />
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor={runnerId}>Runner</label>
            <select
              id={runnerId}
              data-testid="runner-select"
              value={selectedRunnerId}
              onChange={(event) => onRunnerChange(event.currentTarget.value)}
              disabled={creating || runners.length === 0}
            >
              {runners.length === 0 ? (
                <option value="">No authorized Runner available</option>
              ) : null}
              {runners.map((runner) => (
                <option key={runner.id} value={runner.id}>
                  {runner.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor={profileId}>Model profile</label>
            <select
              id={profileId}
              data-testid="model-profile-select"
              value={selectedProfileId}
              onChange={(event) => onProfileChange(event.currentTarget.value)}
              disabled={creating || profileLoading || modelProfiles.length === 0}
            >
              {modelProfiles.length === 0 ? (
                <option value="">
                  {profileLoading ? "Loading model profiles…" : "No enabled model profile"}
                </option>
              ) : null}
              {modelProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profileLabel(profile)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {profileLoading ? (
          <p className="status-text" role="status">
            Loading model profiles for the selected Runner…
          </p>
        ) : null}

        {selectedProfile !== null ? (
          <p className="field__hint">
            Selected profile: {profileLabel(selectedProfile)}. The model name is shown so the faux
            validation profile is unambiguous.
          </p>
        ) : null}

        {runnersError !== null ? (
          <p className="notice notice--error" role="alert">
            Runner list unavailable: {runnersError}
          </p>
        ) : null}
        {profileError !== null ? (
          <p className="notice notice--error" role="alert">
            Model profile list unavailable: {profileError}
          </p>
        ) : null}
        {blockingMessage !== null ? (
          <p className="notice notice--warning" role="status">
            {blockingMessage}
          </p>
        ) : null}
        {validationError !== null ? (
          <p className="notice notice--error" role="alert">
            {validationError}
          </p>
        ) : null}
        {createError !== null ? (
          <p className="notice notice--error" role="alert">
            {createError}
          </p>
        ) : null}

        <div className="button-row">
          <button
            type="submit"
            className="button button--primary"
            data-testid="create-personal-task"
            disabled={!canSubmit}
          >
            {creating ? "Creating personal task…" : "Create personal task"}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={onCancel}
            disabled={creating}
          >
            Discard
          </button>
        </div>
      </form>
    </section>
  );
}
