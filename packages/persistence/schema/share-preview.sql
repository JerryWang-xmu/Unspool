CREATE TABLE IF NOT EXISTS share_preview (
  id TEXT PRIMARY KEY,
  source_workspace_id TEXT NOT NULL,
  selected_record_ids TEXT NOT NULL CHECK (json_valid(selected_record_ids) AND json_array_length(selected_record_ids) > 0),
  excluded_categories TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (source_workspace_id) REFERENCES workspace(id)
);

CREATE INDEX IF NOT EXISTS idx_share_preview_expiry ON share_preview(expires_at);
