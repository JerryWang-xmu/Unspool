CREATE TABLE IF NOT EXISTS task_context_snapshot (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  context_version_ids TEXT NOT NULL CHECK (json_valid(context_version_ids)),
  rendered_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_context_snapshot_run ON task_context_snapshot(run_id);
