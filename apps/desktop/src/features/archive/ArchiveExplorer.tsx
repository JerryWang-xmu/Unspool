import { useState } from "react";

export interface ArchiveExplorerProps {
  readonly exports: readonly {
    id: string;
    scope: string;
    exportedAt: string;
    missingItems: readonly string[];
    unknownItems: readonly string[];
  }[];
  readonly onSearch: (query: string) => Promise<unknown>;
  readonly onExport: (
    scope: "full_archive" | "selected_tasks" | "owned_node_receipts",
  ) => Promise<void>;
  readonly onDownloadManifest: (exportId: string) => Promise<Blob>;
}

export function ArchiveExplorer({
  exports,
  onSearch,
  onExport,
  onDownloadManifest,
}: ArchiveExplorerProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"full_archive" | "selected_tasks" | "owned_node_receipts">(
    "full_archive",
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel" data-testid="archive-explorer" aria-labelledby="archive-title">
      <h2 id="archive-title">Archive and exports</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void onSearch(query).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        <label htmlFor="archive-search">
          Search archive
          <input
            id="archive-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="button button--ghost">
          Search
        </button>
      </form>
      <label htmlFor="archive-scope">
        Export scope
        <select
          id="archive-scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as typeof scope)}
        >
          <option value="full_archive">Full archive</option>
          <option value="selected_tasks">Selected tasks</option>
          <option value="owned_node_receipts">Owned node receipts</option>
        </select>
      </label>
      <button
        type="button"
        className="button button--primary"
        onClick={() => {
          setError(null);
          void onExport(scope).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        Create export
      </button>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <ul>
        {exports.map((exported) => (
          <li key={exported.id} data-testid="archive-export-item">
            <span>
              {exported.scope} · {exported.exportedAt}
            </span>
            {exported.missingItems.length > 0 ? (
              <span data-testid="archive-missing">
                {" "}
                Missing: {exported.missingItems.join(", ")}
              </span>
            ) : null}
            {exported.unknownItems.length > 0 ? (
              <span data-testid="archive-unknown">
                {" "}
                Unknown: {exported.unknownItems.join(", ")}
              </span>
            ) : null}
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                void onDownloadManifest(exported.id)
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `${exported.id}.json`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  );
              }}
            >
              Download manifest
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
