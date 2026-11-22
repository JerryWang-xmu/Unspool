CREATE TABLE IF NOT EXISTS clarification_publication (
  id TEXT PRIMARY KEY,
  preparation_session_id TEXT NOT NULL REFERENCES preparation_session(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('discussion', 'context', 'handoff_note')),
  target_id TEXT NOT NULL,
  edited_body TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES user(id),
  published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clarification_publication_target ON clarification_publication(target_type, target_id, published_at);
CREATE TRIGGER IF NOT EXISTS clarification_publication_no_update BEFORE UPDATE ON clarification_publication BEGIN SELECT RAISE(ABORT, 'clarification_publication is immutable'); END;
CREATE TRIGGER IF NOT EXISTS clarification_publication_no_delete BEFORE DELETE ON clarification_publication BEGIN SELECT RAISE(ABORT, 'clarification_publication is immutable'); END;
