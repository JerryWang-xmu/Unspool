CREATE TABLE IF NOT EXISTS input_item (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('discussion', 'suggestion', 'agent_instruction')),
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  "references" TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (author_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_input_item_workspace_kind ON input_item(workspace_id, kind, created_at);
