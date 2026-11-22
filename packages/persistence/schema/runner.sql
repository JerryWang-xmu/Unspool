CREATE TABLE IF NOT EXISTS runner (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'busy', 'offline', 'upgrading', 'error', 'disabled')),
  version TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 0),
  last_heartbeat_at TEXT NOT NULL
);
