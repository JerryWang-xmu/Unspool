CREATE TABLE IF NOT EXISTS citation (
  private_qa_id TEXT NOT NULL REFERENCES private_qa(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (private_qa_id, source_type, source_id, source_revision)
);
CREATE INDEX IF NOT EXISTS idx_citation_source ON citation(source_type, source_id, source_revision);
CREATE TRIGGER IF NOT EXISTS citation_no_update BEFORE UPDATE ON citation BEGIN SELECT RAISE(ABORT, 'citation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS citation_no_delete BEFORE DELETE ON citation BEGIN SELECT RAISE(ABORT, 'citation is immutable'); END;
