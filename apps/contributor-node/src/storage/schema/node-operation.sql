CREATE TABLE IF NOT EXISTS node_operation (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT,
  unknown_reason TEXT,
  result_digest TEXT,
  UNIQUE (node_id, request_id)
);
