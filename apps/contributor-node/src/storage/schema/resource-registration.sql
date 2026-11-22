CREATE TABLE IF NOT EXISTS resource_registration (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES contributor_node(id),
  kind TEXT NOT NULL,
  local_alias TEXT NOT NULL,
  display_metadata TEXT NOT NULL CHECK (json_valid(display_metadata)),
  allowed_operations TEXT NOT NULL CHECK (json_valid(allowed_operations)),
  template_digest TEXT,
  registered_at TEXT NOT NULL
);
