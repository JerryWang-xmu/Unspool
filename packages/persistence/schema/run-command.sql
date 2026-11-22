-- RunCommand (data-model.md section 4).
-- commandId is the idempotency key scoped to the actor. payload uses canonical
-- JSON and payload_digest binds the canonical payload with SHA-256.
CREATE TABLE IF NOT EXISTS run_command (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'steer', 'follow_up', 'stop', 'queue_action')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  payload_digest TEXT NOT NULL CHECK (
    length(payload_digest) = 71
    AND substr(payload_digest, 1, 7) = 'sha256:'
    AND substr(payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  command_id TEXT NOT NULL CHECK (length(trim(command_id)) > 0),
  actor_id TEXT NOT NULL,
  operator_epoch INTEGER NOT NULL CHECK (operator_epoch >= 1),
  accepted_at TEXT NOT NULL CHECK (length(trim(accepted_at)) > 0),
  result_ref TEXT,
  UNIQUE (actor_id, command_id),
  FOREIGN KEY (run_id) REFERENCES run(id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (actor_id) REFERENCES user(id),
  CHECK (kind = 'start' OR run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_run_command_run
  ON run_command (run_id, accepted_at)
  WHERE run_id IS NOT NULL;
