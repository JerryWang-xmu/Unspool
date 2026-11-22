CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  beta_enabled INTEGER NOT NULL DEFAULT 0 CHECK (beta_enabled IN (0, 1)),
  default_policy_revision INTEGER NOT NULL DEFAULT 1 CHECK (default_policy_revision >= 1),
  created_at TEXT NOT NULL
) STRICT;
