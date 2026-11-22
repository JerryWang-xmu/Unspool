CREATE TABLE IF NOT EXISTS share_conversion (
  id TEXT PRIMARY KEY,
  source_workspace_id TEXT NOT NULL,
  target_workspace_id TEXT NOT NULL,
  selected_record_ids TEXT NOT NULL CHECK (json_valid(selected_record_ids) AND json_array_length(selected_record_ids) > 0),
  source_run_stopped_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (source_workspace_id != target_workspace_id),
  CHECK (source_run_stopped_at <= created_at),
  FOREIGN KEY (source_workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (target_workspace_id) REFERENCES workspace(id)
);

CREATE INDEX IF NOT EXISTS idx_share_conversion_source ON share_conversion(source_workspace_id);
