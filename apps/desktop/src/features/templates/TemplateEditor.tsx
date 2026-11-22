import { useState } from "react";

export interface TemplateEditorProps {
  readonly onSave: (input: {
    name: string;
    goal: string;
    context: { title: string; body: string }[];
    approvalPolicy: { required: boolean; approverIds: string[] };
  }) => Promise<void>;
}

export function TemplateEditor({ onSave }: TemplateEditorProps) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvers, setApprovers] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      className="panel"
      data-testid="template-editor"
      aria-labelledby="template-editor-title"
    >
      <h2 id="template-editor-title">Reusable task template</h2>
      <label htmlFor="template-name">
        Name
        <input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label htmlFor="template-goal">
        Goal
        <textarea
          id="template-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
        />
      </label>
      <label htmlFor="template-context">
        Context
        <textarea
          id="template-context"
          value={context}
          onChange={(event) => setContext(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={approvalRequired}
          onChange={(event) => setApprovalRequired(event.target.checked)}
        />
        Require independent approval
      </label>
      <label htmlFor="template-approvers">
        Approver IDs (comma separated)
        <input
          id="template-approvers"
          value={approvers}
          onChange={(event) => setApprovers(event.target.value)}
        />
      </label>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        onClick={() => {
          setError(null);
          void onSave({
            name: name.trim(),
            goal: goal.trim(),
            context: context.trim() ? [{ title: "Context", body: context.trim() }] : [],
            approvalPolicy: {
              required: approvalRequired,
              approverIds: approvers
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean),
            },
          }).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        Save template
      </button>
    </section>
  );
}
