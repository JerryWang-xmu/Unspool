CREATE TABLE IF NOT EXISTS private_qa (
  id TEXT PRIMARY KEY,
  preparation_session_id TEXT NOT NULL REFERENCES preparation_session(id),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  as_of_revision INTEGER NOT NULL CHECK (as_of_revision >= 1),
  answer_kind TEXT NOT NULL CHECK (answer_kind IN ('sourced', 'speculative', 'unknown', 'permission_denied')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_private_qa_session ON private_qa(preparation_session_id, created_at);
