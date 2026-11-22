CREATE TABLE IF NOT EXISTS context_item (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  kind TEXT NOT NULL CHECK (
    kind IN ('goal', 'fact', 'decision', 'constraint', 'todo', 'blocker', 'reference')
  ),
  current_version_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (current_version_id) REFERENCES context_version (id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX IF NOT EXISTS context_item_workspace_idx
  ON context_item (workspace_id, created_at);

CREATE TRIGGER IF NOT EXISTS context_item_no_delete
BEFORE DELETE ON context_item
BEGIN
  SELECT RAISE(ABORT, 'context items are removed by state, not deleted');
END;
