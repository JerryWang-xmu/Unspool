CREATE TABLE IF NOT EXISTS membership (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES team (id),
  user_id TEXT NOT NULL REFERENCES user (id),
  team_roles TEXT NOT NULL CHECK (
    json_valid(team_roles)
    AND json_type(team_roles) = 'array'
    AND json_array_length(team_roles) >= 1
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  expires_at TEXT CHECK (expires_at IS NULL OR julianday(expires_at) IS NOT NULL),
  UNIQUE (team_id, user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS membership_team_status_idx
  ON membership (team_id, status, expires_at);

CREATE INDEX IF NOT EXISTS membership_user_idx
  ON membership (user_id);
