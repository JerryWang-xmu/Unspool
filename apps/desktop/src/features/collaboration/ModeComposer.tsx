import { useId, useMemo, useState } from "react";
import type {
  CollaborationClient,
  CollaborationInput,
  WorkspaceRole,
} from "../../api/collaborationTypes";

export type CollaborationComposeMode = "discussion" | "suggestion" | "agent_instruction";

export interface ModeComposerPermissions {
  readonly canDiscuss: boolean;
  readonly canSuggest: boolean;
  readonly canDirectInstruction: boolean;
  readonly canDecideSuggestions: boolean;
}

export interface ModeComposerProps {
  readonly client: CollaborationClient;
  readonly workspaceId: string;
  readonly permissions: ModeComposerPermissions;
  readonly role?: WorkspaceRole | null | undefined;
  readonly suggestions?: readonly CollaborationInput[] | undefined;
  readonly disabledReason?: string | null | undefined;
  readonly onPosted?: ((input: CollaborationInput) => void) | undefined;
  readonly onSuggestionDecided?: ((suggestion: CollaborationInput) => void) | undefined;
}

interface ModeCopy {
  readonly label: string;
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly hint: string;
  readonly consequence: string;
  readonly blocked: string;
  readonly submitting: string;
  readonly submit: string;
  readonly success: string;
  readonly permission: keyof ModeComposerPermissions;
}

const MODE_ORDER: readonly CollaborationComposeMode[] = [
  "discussion",
  "suggestion",
  "agent_instruction",
];

const MODE_COPY: Readonly<Record<CollaborationComposeMode, ModeCopy>> = {
  discussion: {
    label: "Discussion",
    inputLabel: "Discussion draft",
    placeholder: "Share context or ask a question for the workspace members.",
    hint: "Discussion is visible to workspace members and is not sent to the Agent.",
    consequence:
      "Posting a discussion records member-visible context only. It does not start a Run, steer the Agent, or create an instruction.",
    blocked: "Your workspace permissions do not allow posting discussions.",
    submitting: "Posting discussion...",
    submit: "Post discussion",
    success: "Discussion posted. It is visible to workspace members and does not affect the Agent.",
    permission: "canDiscuss",
  },
  suggestion: {
    label: "Suggestion",
    inputLabel: "Suggestion draft",
    placeholder: "Describe an instruction the current operator could adopt.",
    hint: "Suggestions are recorded separately and do not affect the Agent until the operator decides.",
    consequence:
      "A suggestion keeps your attribution and the operator's decision. It only reaches the Agent if the current operator adopts it or adopts an edited version; ignoring it has no execution effect.",
    blocked: "Your workspace permissions do not allow submitting suggestions.",
    submitting: "Submitting suggestion...",
    submit: "Submit suggestion",
    success:
      "Suggestion recorded. It has no Agent effect until the current operator adopts it or adopts an edited version.",
    permission: "canSuggest",
  },
  agent_instruction: {
    label: "Direct instruction",
    inputLabel: "Direct instruction draft",
    placeholder: "Describe the instruction the current operator wants the Agent to receive.",
    hint: "Only the current operator can send a direct instruction. It reaches the Agent; it does not start a Run by itself.",
    consequence:
      "A direct instruction is attributed to you as the current operator and cannot be silently edited after acceptance. Starting, steering, and stopping a Run remain separate commands, and high-risk actions still require approval.",
    blocked:
      "Only the current operator can send direct Agent instructions. Continue with a suggestion draft instead; it is not executed automatically.",
    submitting: "Sending direct instruction...",
    submit: "Send direct instruction",
    success:
      "Direct instruction recorded. Starting or steering the Run remains a separate operator command; high-risk actions still require approval.",
    permission: "canDirectInstruction",
  },
};

const EMPTY_DRAFTS: Readonly<Record<CollaborationComposeMode, string>> = {
  discussion: "",
  suggestion: "",
  agent_instruction: "",
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function suggestionStatusLabel(status: CollaborationInput["status"]): string {
  switch (status) {
    case "adopted":
      return "Adopted";
    case "edited_adopted":
      return "Adopted with edits";
    case "ignored":
      return "Ignored";
    case "pending":
    case undefined:
    case null:
      return "Pending operator decision";
    default:
      return status;
  }
}

function decisionFeedback(decision: "adopted" | "edited_adopted" | "ignored"): string {
  switch (decision) {
    case "adopted":
      return "Suggestion adopted. The Runner created an Agent instruction and kept both the suggester and the deciding operator.";
    case "edited_adopted":
      return "Edited suggestion adopted. The Runner created an Agent instruction with the edited text and kept both attributions.";
    case "ignored":
      return "Suggestion ignored. It remains recorded and has no Agent effect.";
    default:
      return "Suggestion decision recorded.";
  }
}

export function ModeComposer({
  client,
  workspaceId,
  permissions,
  role,
  suggestions,
  disabledReason,
  onPosted,
  onSuggestionDecided,
}: ModeComposerProps) {
  const titleId = useId();
  const inputId = useId();
  const suggestionsTitleId = useId();
  const editId = useId();
  const [mode, setMode] = useState<CollaborationComposeMode>("discussion");
  const [drafts, setDrafts] =
    useState<Readonly<Record<CollaborationComposeMode, string>>>(EMPTY_DRAFTS);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [localSuggestions, setLocalSuggestions] = useState<readonly CollaborationInput[]>([]);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const copy = MODE_COPY[mode];
  const allowed = permissions[copy.permission];
  const blockedReason =
    disabledReason !== null && disabledReason !== undefined && disabledReason.trim().length > 0
      ? disabledReason
      : null;
  const blocked = blockedReason !== null;
  const draft = drafts[mode];
  const postingDisabled = posting || blocked || !allowed || draft.trim().length === 0;

  const allSuggestions = useMemo(() => {
    const byId = new Map<string, CollaborationInput>();
    for (const suggestion of localSuggestions) {
      byId.set(suggestion.id, suggestion);
    }
    for (const suggestion of suggestions ?? []) {
      if (!byId.has(suggestion.id)) {
        byId.set(suggestion.id, suggestion);
      }
    }
    return [...byId.values()].sort((left, right) => {
      const leftPending =
        left.status === "pending" || left.status === undefined || left.status === null;
      const rightPending =
        right.status === "pending" || right.status === undefined || right.status === null;
      if (leftPending !== rightPending) {
        return leftPending ? -1 : 1;
      }
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        return 0;
      }
      return rightTime - leftTime;
    });
  }, [localSuggestions, suggestions]);

  const pendingSuggestions = allSuggestions.filter(
    (suggestion) =>
      suggestion.status === "pending" ||
      suggestion.status === undefined ||
      suggestion.status === null,
  );

  function changeMode(next: CollaborationComposeMode): void {
    setMode(next);
    setError(null);
    setFeedback(null);
    setDecisionError(null);
  }

  function changeDraft(value: string): void {
    setDrafts((current) => ({ ...current, [mode]: value }));
  }

  function replaceSuggestion(updated: CollaborationInput): void {
    setLocalSuggestions((current) => [
      updated,
      ...current.filter((suggestion) => suggestion.id !== updated.id),
    ]);
  }

  async function handlePost(): Promise<void> {
    const body = draft.trim();
    if (blocked) {
      setError(blockedReason);
      return;
    }
    if (!allowed) {
      setError(copy.blocked);
      return;
    }
    if (body.length === 0) {
      setError(`Enter a ${copy.label.toLowerCase()} before sending.`);
      return;
    }

    setPosting(true);
    setError(null);
    setFeedback(null);
    try {
      const posted =
        mode === "discussion"
          ? await client.postDiscussion(workspaceId, body)
          : mode === "suggestion"
            ? await client.postSuggestion(workspaceId, body)
            : await client.postDirectInstruction(workspaceId, body);

      if (posted.workspaceId !== workspaceId || posted.kind !== mode) {
        setError(
          "The Runner recorded a response that does not match the requested workspace or input mode. Treat this posting as unconfirmed and review the timeline before relying on it.",
        );
        return;
      }

      setDrafts((current) => ({ ...current, [mode]: "" }));
      if (mode === "suggestion") {
        replaceSuggestion(posted);
      }
      setFeedback(copy.success);
      onPosted?.(posted);
    } catch (cause) {
      setError(`${copy.label} was not recorded: ${errorMessage(cause)}`);
    } finally {
      setPosting(false);
    }
  }

  function continueAsSuggestion(): void {
    const directDraft = drafts.agent_instruction;
    const hasSuggestionDraft = drafts.suggestion.trim().length > 0;
    if (!hasSuggestionDraft && directDraft.trim().length > 0) {
      setDrafts((current) => ({ ...current, suggestion: directDraft }));
    }
    setMode("suggestion");
    setError(null);
    setFeedback(
      hasSuggestionDraft
        ? "Switched to your existing suggestion draft. The direct-instruction draft remains separate."
        : directDraft.trim().length > 0
          ? "The direct-instruction text was copied into a separate suggestion draft. Nothing has been sent."
          : "The suggestion draft is ready. Nothing has been sent.",
    );
  }

  async function handleDecision(
    suggestion: CollaborationInput,
    decision: "adopted" | "edited_adopted" | "ignored",
    editedBody?: string,
  ): Promise<void> {
    if (blocked) {
      setDecisionError(blockedReason);
      return;
    }
    if (!permissions.canDecideSuggestions) {
      setDecisionError(
        "Only the current operator can decide suggestions. Your role can keep discussing or submit a new suggestion.",
      );
      return;
    }
    const body = editedBody === undefined ? "" : editedBody.trim();
    if (decision === "edited_adopted" && body.length === 0) {
      setDecisionError("Enter the edited instruction before adopting the suggestion.");
      return;
    }

    setDecidingId(suggestion.id);
    setDecisionError(null);
    setFeedback(null);
    try {
      const decided = await client.decideSuggestion(
        workspaceId,
        suggestion.id,
        decision,
        decision === "edited_adopted" ? body : undefined,
      );
      if (
        decided.workspaceId !== workspaceId ||
        decided.kind !== "suggestion" ||
        decided.id !== suggestion.id
      ) {
        setDecisionError(
          "The Runner returned a decision that does not match this suggestion. Treat the decision as unconfirmed and refresh the suggestion list.",
        );
        return;
      }
      replaceSuggestion(decided);
      setEditingSuggestionId(null);
      setEditingBody("");
      setFeedback(decisionFeedback(decision));
      onSuggestionDecided?.(decided);
    } catch (cause) {
      setDecisionError(`Suggestion decision failed: ${errorMessage(cause)}`);
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section className="panel composer" data-testid="mode-composer" aria-labelledby={titleId}>
      <div className="panel__header panel__header--compact">
        <div>
          <p className="eyebrow">Collaboration input</p>
          <h2 id={titleId}>Discussion, suggestion, or direct instruction</h2>
          <p className="panel__hint">
            Each mode keeps its own draft. The distinction is enforced by the Runner, not just by
            this form.
          </p>
        </div>
      </div>

      {role !== null && role !== undefined ? (
        <p className="field__hint" data-testid="mode-composer-role">
          Your workspace role: <strong>{role}</strong>.
        </p>
      ) : null}

      <fieldset className="mode-tabs">
        <legend className="sr-only">Collaboration input mode</legend>
        {MODE_ORDER.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="mode-tabs__button"
            data-testid={`collaboration-mode-${candidate}`}
            aria-pressed={mode === candidate}
            disabled={posting || decidingId !== null}
            onClick={() => changeMode(candidate)}
          >
            {MODE_COPY[candidate].label}
          </button>
        ))}
      </fieldset>

      <p className="field__hint">{copy.hint}</p>
      <p
        className={
          mode === "agent_instruction" ? "notice notice--warning" : "notice notice--success"
        }
        role="note"
        data-testid="mode-consequence"
      >
        {copy.consequence}
      </p>

      {blockedReason !== null ? (
        <p className="notice notice--warning" role="status">
          {blockedReason}
        </p>
      ) : null}
      {!allowed && !blocked ? (
        <p className="notice notice--warning" role="status">
          {copy.blocked}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor={inputId}>{copy.inputLabel}</label>
        <textarea
          id={inputId}
          data-testid="collaboration-input"
          value={draft}
          onChange={(event) => changeDraft(event.currentTarget.value)}
          rows={4}
          placeholder={copy.placeholder}
          disabled={posting || blocked}
        />
        <p className="field__hint">
          {draft.length} characters. Switching modes preserves this draft independently.
        </p>
      </div>

      {mode === "agent_instruction" && !allowed && !blocked ? (
        <div className="button-row">
          <button
            type="button"
            className="button button--ghost"
            onClick={continueAsSuggestion}
            disabled={posting}
          >
            Continue as suggestion
          </button>
        </div>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="button button--primary"
          data-testid="submit-collaboration-input"
          onClick={() => {
            void handlePost();
          }}
          disabled={postingDisabled}
          aria-busy={posting}
        >
          {posting ? copy.submitting : copy.submit}
        </button>
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

      <section aria-labelledby={suggestionsTitleId}>
        <h3 id={suggestionsTitleId}>Suggestions awaiting or recording a decision</h3>
        <p className="field__hint">
          A suggestion never affects the Agent by itself. The current operator decides; adopting
          creates a separate Agent instruction and both attributions remain visible.
        </p>

        {pendingSuggestions.length === 0 ? (
          <p className="status-text" role="status">
            No pending suggestions. Decided suggestions remain below with their recorded outcome.
          </p>
        ) : null}

        {allSuggestions.length === 0 ? (
          <p className="status-text" role="status">
            No suggestions have been recorded for this workspace.
          </p>
        ) : (
          <ul className="tool-list">
            {allSuggestions.map((suggestion) => {
              const pending =
                suggestion.status === "pending" ||
                suggestion.status === undefined ||
                suggestion.status === null;
              const editing = editingSuggestionId === suggestion.id;
              const busy = decidingId !== null;
              const suggestedBy = suggestion.suggestedBy ?? suggestion.authorId;
              return (
                <li
                  key={suggestion.id}
                  className="tool-call"
                  data-testid="suggestion-item"
                  data-suggestion-id={suggestion.id}
                >
                  <div className="tool-call__header">
                    <span className={pending ? "tag tag--warning" : "tag"}>
                      {suggestionStatusLabel(suggestion.status)}
                    </span>
                    <time dateTime={suggestion.createdAt}>
                      {formatTimestamp(suggestion.createdAt)}
                    </time>
                    <span>Suggested by {suggestedBy}</span>
                    {suggestion.decidedBy !== null && suggestion.decidedBy !== undefined ? (
                      <span>Decided by {suggestion.decidedBy}</span>
                    ) : null}
                  </div>
                  <pre className="output__pre">{suggestion.body}</pre>
                  {suggestion.editedBody !== null && suggestion.editedBody !== undefined ? (
                    <>
                      <p className="field__hint">Edited instruction adopted:</p>
                      <pre className="output__pre">{suggestion.editedBody}</pre>
                    </>
                  ) : null}
                  {suggestion.resultingInputId !== null &&
                  suggestion.resultingInputId !== undefined ? (
                    <p className="field__hint">
                      Resulting Agent instruction:{" "}
                      <span data-testid="suggestion-resulting-input">
                        {suggestion.resultingInputId}
                      </span>
                    </p>
                  ) : null}

                  {pending ? (
                    editing ? (
                      <div className="field">
                        <label htmlFor={`${editId}-${suggestion.id}`}>
                          Edited instruction to adopt
                        </label>
                        <textarea
                          id={`${editId}-${suggestion.id}`}
                          value={editingBody}
                          onChange={(event) => setEditingBody(event.currentTarget.value)}
                          rows={4}
                          disabled={busy}
                        />
                        <div className="button-row">
                          <button
                            type="button"
                            className="button button--primary"
                            onClick={() => {
                              void handleDecision(suggestion, "edited_adopted", editingBody);
                            }}
                            disabled={busy || editingBody.trim().length === 0}
                          >
                            Adopt edited instruction
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => {
                              setEditingSuggestionId(null);
                              setEditingBody("");
                            }}
                            disabled={busy}
                          >
                            Cancel edit
                          </button>
                        </div>
                      </div>
                    ) : permissions.canDecideSuggestions && !blocked ? (
                      <div className="button-row">
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => {
                            void handleDecision(suggestion, "adopted");
                          }}
                          disabled={busy}
                        >
                          Adopt
                        </button>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => {
                            setEditingSuggestionId(suggestion.id);
                            setEditingBody(suggestion.body);
                            setDecisionError(null);
                          }}
                          disabled={busy}
                        >
                          Edit then adopt
                        </button>
                        <button
                          type="button"
                          className="button button--danger"
                          onClick={() => {
                            void handleDecision(suggestion, "ignored");
                          }}
                          disabled={busy}
                        >
                          Ignore
                        </button>
                      </div>
                    ) : (
                      <p className="field__hint">
                        Only the current operator can adopt, edit-adopt, or ignore this suggestion.
                      </p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {decisionError !== null ? (
          <p className="notice notice--error" role="alert">
            {decisionError}
          </p>
        ) : null}
      </section>
    </section>
  );
}
