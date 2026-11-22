CREATE TABLE IF NOT EXISTS node_receipt (
  event_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  node_sequence INTEGER NOT NULL CHECK (node_sequence >= 1),
  previous_digest TEXT NOT NULL,
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  execution_id TEXT,
  actor TEXT NOT NULL,
  resource_digest TEXT NOT NULL,
  operation TEXT NOT NULL,
  grant_digest TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (json_valid(result)),
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  destinations TEXT NOT NULL CHECK (json_valid(destinations)),
  label_digest TEXT NOT NULL,
  upload_state TEXT NOT NULL,
  node_signature TEXT NOT NULL,
  UNIQUE (node_id, node_sequence)
);
CREATE TRIGGER IF NOT EXISTS node_receipt_no_update BEFORE UPDATE ON node_receipt BEGIN SELECT RAISE(ABORT, 'node_receipt is append-only'); END;
CREATE TRIGGER IF NOT EXISTS node_receipt_no_delete BEFORE DELETE ON node_receipt BEGIN SELECT RAISE(ABORT, 'node_receipt is append-only'); END;
