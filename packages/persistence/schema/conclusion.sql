CREATE TABLE IF NOT EXISTS conclusion (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'assumption', 'decision')),
  body TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unverified', 'confirmed', 'review_required', 'invalid')),
  scope TEXT NOT NULL,
  proposed_by TEXT NOT NULL REFERENCES user(id),
  confirmed_by TEXT REFERENCES user(id),
  confirmed_at TEXT,
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  last_reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conclusion_workspace ON conclusion(workspace_id, state, current_version);
