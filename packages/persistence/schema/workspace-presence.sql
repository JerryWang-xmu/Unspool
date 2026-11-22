CREATE TABLE IF NOT EXISTS workspace_presence (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_presence_seen
  ON workspace_presence(workspace_id, last_seen_at);
