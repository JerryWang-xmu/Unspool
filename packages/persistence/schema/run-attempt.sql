-- RunAttempt (data-model.md section 4).
-- attemptEpoch fences leases, events and results for this attempt id.
CREATE TABLE IF NOT EXISTS run_attempt (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  worker_id TEXT NOT NULL CHECK (length(trim(worker_id)) > 0),
  attempt_epoch INTEGER NOT NULL CHECK (attempt_epoch >= 1),
  state TEXT NOT NULL CHECK (
    state IN ('assigned', 'dispatched', 'running', 'settled', 'outcome_unknown')
  ),
  lease_expires_at TEXT NOT NULL CHECK (length(trim(lease_expires_at)) > 0),
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  settled_at TEXT,
  unknown_reason TEXT,
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE INDEX IF NOT EXISTS idx_run_attempt_run
  ON run_attempt (run_id, started_at);

CREATE INDEX IF NOT EXISTS idx_run_attempt_worker
  ON run_attempt (worker_id, lease_expires_at);
