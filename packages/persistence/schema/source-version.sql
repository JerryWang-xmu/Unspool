CREATE TABLE IF NOT EXISTS source_version (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES evidence_source(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  content_ref TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  supersedes_id TEXT REFERENCES source_version(id),
  UNIQUE (source_id, version),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_source_version_source ON source_version(source_id, version);
CREATE TRIGGER IF NOT EXISTS source_version_no_update BEFORE UPDATE ON source_version BEGIN SELECT RAISE(ABORT, 'source_version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_version_no_delete BEFORE DELETE ON source_version BEGIN SELECT RAISE(ABORT, 'source_version is immutable'); END;
