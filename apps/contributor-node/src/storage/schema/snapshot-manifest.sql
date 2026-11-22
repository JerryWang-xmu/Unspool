CREATE TABLE IF NOT EXISTS snapshot_manifest (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES contributor_node(id),
  resource_id TEXT NOT NULL,
  root_digest TEXT NOT NULL,
  entries TEXT NOT NULL CHECK (json_valid(entries)),
  created_at TEXT NOT NULL,
  path_visibility TEXT NOT NULL CHECK (path_visibility IN ('opaque_only', 'authorized_recipients', 'owner_only')),
  cache_policy TEXT NOT NULL CHECK (json_valid(cache_policy)),
  state TEXT NOT NULL CHECK (state IN ('sealed', 'revoked', 'invalid'))
);
CREATE TRIGGER IF NOT EXISTS snapshot_manifest_no_update BEFORE UPDATE ON snapshot_manifest BEGIN SELECT RAISE(ABORT, 'snapshot_manifest is immutable'); END;
