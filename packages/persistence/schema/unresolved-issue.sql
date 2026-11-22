CREATE TABLE IF NOT EXISTS unresolved_issue (
  id TEXT PRIMARY KEY,
  preparation_session_id TEXT NOT NULL REFERENCES preparation_session(id),
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved'))
);
CREATE INDEX IF NOT EXISTS idx_unresolved_issue_session ON unresolved_issue(preparation_session_id, visibility, status);
