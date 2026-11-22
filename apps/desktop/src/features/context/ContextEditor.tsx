import { useEffect, useId, useState } from "react";
import type {
  CollaborationClient,
  ContextItem,
  ContextVersionInput,
} from "../../api/collaborationTypes";
import { RunnerApiError } from "../../api/runnerClient";

export type ContextEditorClient = Pick<
  CollaborationClient,
  "listContextItems" | "createContextItem" | "appendContextVersion"
>;

export interface ContextEditorProps {
  readonly client: ContextEditorClient;
  readonly workspaceId: string;
  readonly refreshToken?: number | undefined;
  readonly onChanged?: ((item: ContextItem) => void) | undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function ContextEditor({
  client,
  workspaceId,
  refreshToken = 0,
  onChanged,
}: ContextEditorProps) {
  const fieldId = useId();
  const [items, setItems] = useState<readonly ContextItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<"create" | "append">("create");
  const [kind, setKind] = useState("fact");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceRefs, setSourceRefs] = useState("");
  const [visibility, setVisibility] = useState<"members" | "private">("members");
  const [exposure, setExposure] = useState<ContextVersionInput["agentExposure"]>("not_provided");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function reload(): Promise<void> {
    const next = await client.listContextItems(workspaceId);
    setItems(next);
    setSelectedId((current) =>
      next.some((item) => item.id === current) ? current : (next[0]?.id ?? ""),
    );
  }

  useEffect(() => {
    void refreshToken;
    let active = true;
    void client
      .listContextItems(workspaceId)
      .then((next) => {
        if (!active) return;
        setItems(next);
        setSelectedId((current) =>
          next.some((item) => item.id === current) ? current : (next[0]?.id ?? ""),
        );
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [client, workspaceId, refreshToken]);

  async function submit(): Promise<void> {
    if (busy || title.trim().length === 0 || body.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    setNotice(null);
    const input: ContextVersionInput = {
      kind,
      title: title.trim(),
      body: body.trim(),
      memberVisibility: visibility,
      agentExposure: exposure,
      sourceRefs: sourceRefs
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    };
    try {
      if (mode === "append") {
        if (selected === null)
          throw new RunnerApiError("Select a context item before appending a version.");
        const result = await client.appendContextVersion(
          workspaceId,
          selected.id,
          selected.revision,
          input,
        );
        setNotice(`Version ${result.version.version} saved.`);
        onChanged?.(result.item);
      } else {
        const result = await client.createContextItem(workspaceId, input);
        setNotice(`Context ${result.item.id} created.`);
        onChanged?.(result.item);
      }
      await reload();
      setTitle("");
      setBody("");
      setSourceRefs("");
    } catch (cause) {
      setConflict(cause instanceof RunnerApiError && cause.code === "revision_conflict");
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" data-testid="context-editor" aria-labelledby="context-editor-title">
      <h2 id="context-editor-title">Context versions</h2>
      <fieldset className="button-row" aria-label="Context edit mode">
        <button
          type="button"
          className={mode === "create" ? "button button--primary" : "button button--ghost"}
          onClick={() => setMode("create")}
        >
          Create item
        </button>
        <button
          type="button"
          className={mode === "append" ? "button button--primary" : "button button--ghost"}
          onClick={() => setMode("append")}
        >
          Append version
        </button>
      </fieldset>
      {mode === "append" ? (
        <label htmlFor={`${fieldId}-item`}>
          Context item
          <select
            id={`${fieldId}-item`}
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.currentVersion.title} (revision {item.revision})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label htmlFor={`${fieldId}-kind`}>
        Kind
        <select
          id={`${fieldId}-kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          disabled={mode === "append"}
        >
          {["goal", "fact", "decision", "constraint", "todo", "blocker", "reference"].map(
            (value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ),
          )}
        </select>
      </label>
      <label htmlFor={`${fieldId}-title`}>
        Title
        <input
          id={`${fieldId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label htmlFor={`${fieldId}-body`}>
        Body
        <textarea
          id={`${fieldId}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
        />
      </label>
      <label htmlFor={`${fieldId}-refs`}>
        Source references (one per line)
        <textarea
          id={`${fieldId}-refs`}
          value={sourceRefs}
          onChange={(event) => setSourceRefs(event.target.value)}
          rows={2}
        />
      </label>
      <label htmlFor={`${fieldId}-visibility`}>
        Member visibility
        <select
          id={`${fieldId}-visibility`}
          data-testid="member-visibility-select"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as "members" | "private")}
        >
          <option value="members">Members</option>
          <option value="private">Private (author only)</option>
        </select>
      </label>
      <label htmlFor={`${fieldId}-exposure`}>
        Agent exposure
        <select
          id={`${fieldId}-exposure`}
          value={exposure}
          onChange={(event) =>
            setExposure(event.target.value as ContextVersionInput["agentExposure"])
          }
        >
          <option value="not_provided">Not provided to Agent</option>
          <option value="pending_operator">Pending operator approval</option>
          <option value="provide_next_run">Provide on next Run (operator only)</option>
        </select>
      </label>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {conflict ? (
        <div className="notice notice--warning" role="alert">
          <p>
            The context changed elsewhere. Your draft is preserved; reload the latest revision
            before saving again.
          </p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              void reload()
                .then(() => setConflict(false))
                .catch((cause: unknown) => setError(errorMessage(cause)));
            }}
          >
            Reload latest versions
          </button>
        </div>
      ) : null}
      {notice !== null ? (
        <p className="notice notice--success" role="status">
          {notice}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        data-testid="save-context-version"
        disabled={busy || title.trim().length === 0 || body.trim().length === 0}
        onClick={() => {
          void submit();
        }}
      >
        {busy ? "Saving…" : mode === "create" ? "Create context" : "Append version"}
      </button>
      <section aria-label="Current context versions">
        {items.map((item) => (
          <article key={item.id} data-testid="context-item">
            <h3>{item.currentVersion.title}</h3>
            <p>{item.currentVersion.body}</p>
            <p>
              Revision {item.revision} · {item.currentVersion.memberVisibility} ·{" "}
              {item.currentVersion.agentExposure}
            </p>
          </article>
        ))}
      </section>
    </section>
  );
}
