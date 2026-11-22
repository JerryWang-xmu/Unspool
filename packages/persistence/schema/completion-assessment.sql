CREATE TABLE IF NOT EXISTS completion_assessment (
  run_id TEXT PRIMARY KEY,
  result TEXT NOT NULL CHECK (result IN ('complete', 'partial', 'incomplete', 'failed', 'cancelled')),
  reason TEXT,
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  evidence_exception_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_completion_assessment_result ON completion_assessment(result);
