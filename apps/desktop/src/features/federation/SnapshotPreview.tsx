export interface SnapshotPreviewProps {
  readonly pathVisibility: "opaque_only" | "authorized_recipients" | "owner_only";
  readonly entries: readonly {
    entryId: string;
    logicalPath?: string;
    size: number;
    contentDigest: string;
  }[];
  readonly onChangeVisibility: (
    visibility: "opaque_only" | "authorized_recipients" | "owner_only",
  ) => Promise<void>;
}

export function SnapshotPreview({
  pathVisibility,
  entries,
  onChangeVisibility,
}: SnapshotPreviewProps) {
  return (
    <section
      className="panel"
      data-testid="snapshot-preview"
      aria-labelledby="snapshot-preview-title"
    >
      <h2 id="snapshot-preview-title">Read-only snapshot preview</h2>
      <p>Inclusion and path visibility are independent. Read-only Beta has no Patch controls.</p>
      <label htmlFor="snapshot-path-visibility">
        Path visibility
        <select
          id="snapshot-path-visibility"
          value={pathVisibility}
          onChange={(event) => {
            void onChangeVisibility(event.target.value as SnapshotPreviewProps["pathVisibility"]);
          }}
        >
          <option value="opaque_only">Opaque entry IDs only</option>
          <option value="authorized_recipients">Logical paths for authorized recipients</option>
          <option value="owner_only">Logical paths for owner only</option>
        </select>
      </label>
      <ul>
        {entries.map((entry) => (
          <li key={entry.entryId} data-testid="snapshot-entry">
            <code>{entry.logicalPath ?? entry.entryId}</code> · {entry.size} bytes ·{" "}
            {entry.contentDigest}
          </li>
        ))}
      </ul>
    </section>
  );
}
