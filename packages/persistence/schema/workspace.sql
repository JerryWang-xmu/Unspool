CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  team_id TEXT,
  owner_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  goal TEXT NOT NULL DEFAULT '',
  completion_criteria TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  visibility TEXT NOT NULL CHECK (visibility IN ('owner_private', 'invited_members')),
  agent_config_snapshot TEXT NOT NULL,
  federation_mode TEXT NOT NULL CHECK (federation_mode IN ('disabled', 'snapshot', 'snapshot_tools', 'snapshot_tools_patch')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES user(id),
  FOREIGN KEY (runner_id) REFERENCES runner(id),
  CHECK ((kind = 'personal' AND team_id IS NULL) OR (kind = 'shared' AND team_id IS NOT NULL)),
  CHECK (status != 'active' OR (length(trim(goal)) > 0 AND length(trim(completion_criteria)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_workspace_owner_updated ON workspace(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workspace_runner_status ON workspace(runner_id, status);
