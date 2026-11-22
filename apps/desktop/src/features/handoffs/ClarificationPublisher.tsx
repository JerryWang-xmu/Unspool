import { useState } from "react";

export interface ClarificationPublisherProps {
  readonly onPublish: (
    targetType: "discussion" | "context" | "handoff_note",
    editedBody: string,
  ) => Promise<void>;
}

export function ClarificationPublisher({ onPublish }: ClarificationPublisherProps) {
  const [targetType, setTargetType] = useState<"discussion" | "context" | "handoff_note">(
    "discussion",
  );
  const [editedBody, setEditedBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  return (
    <section
      className="panel"
      data-testid="clarification-publisher"
      aria-labelledby="clarification-title"
    >
      <h2 id="clarification-title">Publish an edited clarification</h2>
      <p>
        Only your edited text is published. Original private questions and answers remain private.
      </p>
      <label htmlFor="clarification-target">
        Target scope
        <select
          id="clarification-target"
          value={targetType}
          onChange={(event) => setTargetType(event.target.value as typeof targetType)}
        >
          <option value="discussion">Discussion</option>
          <option value="context">Context</option>
          <option value="handoff_note">Handoff note</option>
        </select>
      </label>
      <label htmlFor="clarification-body">
        Edited clarification
        <textarea
          id="clarification-body"
          value={editedBody}
          onChange={(event) => {
            setEditedBody(event.target.value);
            setPublished(false);
          }}
        />
      </label>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {published ? (
        <p className="notice notice--success" role="status">
          Clarification published by the Runner.
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={busy || editedBody.trim().length === 0}
        onClick={() => {
          setBusy(true);
          setError(null);
          void onPublish(targetType, editedBody.trim())
            .then(() => {
              setPublished(true);
              setEditedBody("");
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false));
        }}
      >
        Publish edited text
      </button>
    </section>
  );
}
