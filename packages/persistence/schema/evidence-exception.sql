CREATE TABLE IF NOT EXISTS evidence_exception (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  conclusion_ids TEXT NOT NULL CHECK (json_valid(conclusion_ids)),
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_exception_run ON evidence_exception(run_id, created_at);
