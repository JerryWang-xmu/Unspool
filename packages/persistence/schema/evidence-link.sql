CREATE TABLE IF NOT EXISTS evidence_link (
  conclusion_id TEXT NOT NULL REFERENCES conclusion(id),
  source_version_id TEXT NOT NULL REFERENCES source_version(id),
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'conflicts', 'context')),
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (conclusion_id, source_version_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_evidence_link_source ON evidence_link(source_version_id, conclusion_id);
