CREATE TABLE IF NOT EXISTS archive_export (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  scope TEXT NOT NULL CHECK (scope IN ('full_archive', 'selected_tasks', 'owned_node_receipts')),
  format_version INTEGER NOT NULL CHECK (format_version >= 1),
  manifest_blob_id TEXT NOT NULL REFERENCES blob_object(id),
  missing_items TEXT NOT NULL CHECK (json_valid(missing_items)),
  unknown_items TEXT NOT NULL CHECK (json_valid(unknown_items)),
  exported_by TEXT NOT NULL REFERENCES user(id),
  exported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_export_workspace ON archive_export(workspace_id, exported_at);
