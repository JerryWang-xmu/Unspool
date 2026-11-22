CREATE TABLE IF NOT EXISTS federation_grant_state (
  id TEXT PRIMARY KEY,
  grant_json TEXT NOT NULL CHECK (json_valid(grant_json)),
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS federation_owner_key (
  owner_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);
