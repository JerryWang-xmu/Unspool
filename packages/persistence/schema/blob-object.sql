CREATE TABLE IF NOT EXISTS blob_object (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  media_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('available', 'missing', 'pending_reconciliation')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blob_object_state ON blob_object(state);
CREATE INDEX IF NOT EXISTS idx_blob_object_sha ON blob_object(sha256);

CREATE TRIGGER IF NOT EXISTS blob_object_no_update
BEFORE UPDATE ON blob_object
BEGIN
  SELECT RAISE(ABORT, 'blob_object is immutable');
END;

CREATE TRIGGER IF NOT EXISTS blob_object_no_delete
BEFORE DELETE ON blob_object
BEGIN
  SELECT RAISE(ABORT, 'blob_object is immutable');
END;
