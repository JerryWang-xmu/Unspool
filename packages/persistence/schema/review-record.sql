CREATE TABLE IF NOT EXISTS review_record (
  id TEXT PRIMARY KEY,
  conclusion_id TEXT NOT NULL REFERENCES conclusion(id),
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_version_ids TEXT NOT NULL CHECK (json_valid(source_version_ids)),
  reviewed_by TEXT NOT NULL REFERENCES user(id),
  reviewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_record_conclusion ON review_record(conclusion_id, reviewed_at);
CREATE TRIGGER IF NOT EXISTS review_record_no_update BEFORE UPDATE ON review_record BEGIN SELECT RAISE(ABORT, 'review_record is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_record_no_delete BEFORE DELETE ON review_record BEGIN SELECT RAISE(ABORT, 'review_record is immutable'); END;
