-- SessionCheckpoint (data-model.md section 4).
-- A row is appended only after pi append completes and Unspool has drained and
-- reconciled its projection; a message_end notification alone is insufficient.
CREATE TABLE IF NOT EXISTS session_checkpoint (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  pi_leaf_id TEXT NOT NULL CHECK (length(trim(pi_leaf_id)) > 0),
  last_persisted_entry_id TEXT NOT NULL CHECK (length(trim(last_persisted_entry_id)) > 0),
  last_projected_event_id TEXT NOT NULL CHECK (length(trim(last_projected_event_id)) > 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  FOREIGN KEY (conversation_id) REFERENCES agent_conversation(id),
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoint_conversation
  ON session_checkpoint (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_session_checkpoint_run
  ON session_checkpoint (run_id, created_at)
  WHERE run_id IS NOT NULL;
