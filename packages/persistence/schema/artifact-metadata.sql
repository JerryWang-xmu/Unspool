CREATE TABLE IF NOT EXISTS artifact_metadata (
  artifact_version_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_version_id) REFERENCES artifact_version(id)
);

CREATE INDEX IF NOT EXISTS idx_artifact_metadata_created ON artifact_metadata(created_at);
