CREATE TABLE IF NOT EXISTS transient_output (
  run_id TEXT NOT NULL,
  offset INTEGER NOT NULL CHECK (offset >= 0),
  delta TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, offset)
);

CREATE INDEX IF NOT EXISTS idx_transient_output_created ON transient_output(run_id, created_at);
