CREATE TABLE IF NOT EXISTS outbox_message (
  id TEXT PRIMARY KEY,
  domain_event_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'dispatched', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_error TEXT,
  FOREIGN KEY (domain_event_id) REFERENCES domain_event(id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_message_dispatch ON outbox_message(state, available_at);
