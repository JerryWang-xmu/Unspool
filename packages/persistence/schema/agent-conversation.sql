-- AgentConversation (data-model.md section 4).
-- pi_session_ref is the exact session reference; there is no "most recent session" lookup.
CREATE TABLE IF NOT EXISTS agent_conversation (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  pi_session_ref TEXT NOT NULL CHECK (length(trim(pi_session_ref)) > 0),
  session_format_version INTEGER NOT NULL CHECK (session_format_version >= 1),
  continuation_of_id TEXT,
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  UNIQUE (pi_session_ref),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (continuation_of_id) REFERENCES agent_conversation(id),
  CHECK (continuation_of_id IS NULL OR continuation_of_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_agent_conversation_workspace
  ON agent_conversation (workspace_id, created_at);
