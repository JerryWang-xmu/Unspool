CREATE TABLE IF NOT EXISTS attribution (
  actor_id TEXT PRIMARY KEY,
  display_name_at_time TEXT NOT NULL,
  roles_at_time TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attribution_time ON attribution(occurred_at);
