CREATE TABLE IF NOT EXISTS evidence_source (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  origin_type TEXT NOT NULL CHECK (origin_type IN ('artifact', 'context', 'external', 'member_input')),
  origin_id TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'review_required', 'superseded', 'revoked', 'invalid', 'unavailable')),
  last_confirmed_at TEXT NOT NULL,
  review_due_at TEXT,
  external_monitoring INTEGER NOT NULL CHECK (external_monitoring IN (0, 1)),
  UNIQUE (workspace_id, origin_type, origin_id)
);
