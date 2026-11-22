CREATE TABLE IF NOT EXISTS suggestion_decision (
  suggestion_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'adopted', 'edited_adopted', 'ignored')),
  suggested_by TEXT,
  decided_by TEXT NOT NULL,
  edited_body TEXT,
  resulting_input_id TEXT,
  decided_at TEXT NOT NULL,
  CHECK (status != 'edited_adopted' OR (edited_body IS NOT NULL AND length(trim(edited_body)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_suggestion_decision_status ON suggestion_decision(status);
