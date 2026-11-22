CREATE TABLE IF NOT EXISTS backup_manifest (
  id TEXT PRIMARY KEY,
  app_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  last_workspace_sequences TEXT NOT NULL,
  object_entries TEXT NOT NULL,
  session_entries TEXT NOT NULL,
  created_at TEXT NOT NULL,
  digest TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_manifest_created ON backup_manifest(created_at);
