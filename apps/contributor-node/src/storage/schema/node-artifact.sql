CREATE TABLE IF NOT EXISTS node_artifact (
  id TEXT PRIMARY KEY,
  origin_node_ids TEXT NOT NULL CHECK (json_valid(origin_node_ids)),
  origin_owner_ids TEXT NOT NULL CHECK (json_valid(origin_owner_ids)),
  origin_grant_digests TEXT NOT NULL CHECK (json_valid(origin_grant_digests)),
  derived_from TEXT NOT NULL CHECK (json_valid(derived_from)),
  content_digest TEXT NOT NULL,
  security_label_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
