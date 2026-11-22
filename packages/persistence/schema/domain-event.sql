CREATE TABLE IF NOT EXISTS domain_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  type TEXT NOT NULL,
  actor_id TEXT,
  run_id TEXT,
  occurred_at TEXT NOT NULL,
  visibility TEXT NOT NULL,
  payload_ref TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE (workspace_id, sequence),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id)
);

CREATE INDEX IF NOT EXISTS idx_domain_event_workspace_sequence ON domain_event(workspace_id, sequence);
CREATE INDEX IF NOT EXISTS idx_domain_event_run ON domain_event(run_id);
CREATE INDEX IF NOT EXISTS idx_domain_event_type ON domain_event(workspace_id, type);

CREATE TRIGGER IF NOT EXISTS domain_event_no_update
BEFORE UPDATE ON domain_event
BEGIN
  SELECT RAISE(ABORT, 'domain_event is append-only');
END;

CREATE TRIGGER IF NOT EXISTS domain_event_no_delete
BEFORE DELETE ON domain_event
BEGIN
  SELECT RAISE(ABORT, 'domain_event is append-only');
END;
