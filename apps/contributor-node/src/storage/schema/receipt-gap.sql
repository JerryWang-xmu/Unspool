CREATE TABLE IF NOT EXISTS receipt_gap (
  node_id TEXT NOT NULL,
  from_sequence INTEGER NOT NULL CHECK (from_sequence >= 1),
  to_sequence INTEGER NOT NULL CHECK (to_sequence >= from_sequence),
  detected_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (node_id, from_sequence, to_sequence)
);
