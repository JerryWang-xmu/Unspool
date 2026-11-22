CREATE TABLE IF NOT EXISTS command_receipt (
  actor_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  response_digest TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY (actor_id, command_id)
);

CREATE INDEX IF NOT EXISTS idx_command_receipt_workspace ON command_receipt(workspace_id, accepted_at);
