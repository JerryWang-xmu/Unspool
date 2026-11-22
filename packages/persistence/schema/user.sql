CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  auth_version INTEGER NOT NULL CHECK (auth_version >= 1),
  created_at TEXT NOT NULL,
  disabled_at TEXT,
  CHECK ((status = 'active' AND disabled_at IS NULL) OR (status = 'disabled' AND disabled_at IS NOT NULL))
);
