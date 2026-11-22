CREATE TABLE IF NOT EXISTS preparation_session (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES handoff_invitation(id),
  recipient_id TEXT NOT NULL REFERENCES user(id),
  read_only_conversation_id TEXT NOT NULL REFERENCES agent_conversation(id),
  as_of_revision INTEGER NOT NULL CHECK (as_of_revision >= 1),
  latest_revision INTEGER NOT NULL CHECK (latest_revision >= as_of_revision),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (handoff_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_preparation_recipient ON preparation_session(recipient_id, status, started_at);
