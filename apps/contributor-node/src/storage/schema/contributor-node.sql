CREATE TABLE IF NOT EXISTS contributor_node (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  owner_approval_public_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  state TEXT NOT NULL,
  support_state TEXT NOT NULL,
  security_posture TEXT NOT NULL,
  capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 1),
  last_heartbeat_at TEXT NOT NULL
);
