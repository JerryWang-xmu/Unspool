CREATE TABLE IF NOT EXISTS analytics_event (
  event_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_pseudonym TEXT,
  workspace_pseudonym TEXT,
  metadata TEXT NOT NULL CHECK (json_valid(metadata) AND json_type(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_name_time ON analytics_event(event_name, occurred_at);
