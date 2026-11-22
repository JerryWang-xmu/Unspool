CREATE TABLE IF NOT EXISTS artifact_version (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  blob_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reference', 'agent_output', 'node_artifact', 'patch', 'export')),
  origin_type TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  run_id TEXT,
  attribution TEXT NOT NULL,
  security_label_id TEXT NOT NULL,
  source_summary TEXT NOT NULL,
  UNIQUE (artifact_id, version),
  FOREIGN KEY (blob_id) REFERENCES blob_object(id),
  FOREIGN KEY (security_label_id) REFERENCES security_label(id)
);

CREATE INDEX IF NOT EXISTS idx_artifact_version_run ON artifact_version(run_id);
CREATE INDEX IF NOT EXISTS idx_artifact_version_label ON artifact_version(security_label_id);
