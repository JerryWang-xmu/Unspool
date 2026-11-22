import { useState } from "react";
import { CitationList, type CitationView } from "./CitationList";

export interface PreparationQA {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly answerKind: string;
  readonly citations: readonly CitationView[];
}

export interface PreparationWorkspaceProps {
  readonly asOfRevision: number;
  readonly latestRevision: number;
  readonly questions: readonly PreparationQA[];
  readonly unresolvedIssues: readonly {
    id: string;
    body: string;
    visibility: string;
    status: string;
  }[];
  readonly onAsk: (question: string) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRecordIssue: (body: string, shared: boolean) => Promise<void>;
}

export function PreparationWorkspace({
  asOfRevision,
  latestRevision,
  questions,
  unresolvedIssues,
  onAsk,
  onRefresh,
  onRecordIssue,
}: PreparationWorkspaceProps) {
  const [question, setQuestion] = useState("");
  const [issue, setIssue] = useState("");
  const [shareIssue, setShareIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel"
      data-testid="preparation-workspace"
      aria-labelledby="preparation-title"
    >
      <h2 id="preparation-title">Private read-only preparation</h2>
      <p>
        Prepared at revision {asOfRevision}; latest available revision {latestRevision}. No
        main-session prompt or tool is used.
      </p>
      {latestRevision > asOfRevision ? (
        <div className="notice notice--warning" role="alert">
          <p>Background changed. Refresh before accepting responsibility.</p>
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
        </div>
      ) : null}
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <label htmlFor="preparation-question">
        Ask a private question
        <textarea
          id="preparation-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="button button--primary"
        disabled={busy || question.trim().length === 0}
        onClick={() => {
          void run(async () => {
            await onAsk(question.trim());
            setQuestion("");
          });
        }}
      >
        Ask read-only question
      </button>
      <section aria-label="Private answers">
        {questions.map((qa) => (
          <article key={qa.id} data-testid="private-answer">
            <h3>{qa.question}</h3>
            <p>{qa.answer}</p>
            <p>Answer kind: {qa.answerKind}</p>
            <CitationList citations={qa.citations} />
          </article>
        ))}
      </section>
      <label htmlFor="preparation-issue">
        Unresolved issue
        <textarea
          id="preparation-issue"
          value={issue}
          onChange={(event) => setIssue(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={shareIssue}
          onChange={(event) => setShareIssue(event.target.checked)}
        />{" "}
        Share only this issue text with workspace members
      </label>
      <button
        type="button"
        className="button button--ghost"
        disabled={busy || issue.trim().length === 0}
        onClick={() => {
          void run(async () => {
            await onRecordIssue(issue.trim(), shareIssue);
            setIssue("");
            setShareIssue(false);
          });
        }}
      >
        Record issue
      </button>
      <ul>
        {unresolvedIssues.map((item) => (
          <li key={item.id}>
            {item.body} · {item.visibility} · {item.status}
          </li>
        ))}
      </ul>
    </section>
  );
}
