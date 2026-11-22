CREATE TABLE IF NOT EXISTS schema_migration (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  backup_manifest_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_migration_applied_at ON schema_migration(applied_at);
