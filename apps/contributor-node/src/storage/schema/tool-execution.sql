CREATE TABLE IF NOT EXISTS tool_execution (
  id TEXT PRIMARY KEY,
  node_operation_id TEXT NOT NULL REFERENCES node_operation(id),
  template_digest TEXT NOT NULL,
  canonical_args TEXT NOT NULL CHECK (json_valid(canonical_args)),
  resource_budget TEXT NOT NULL CHECK (json_valid(resource_budget)),
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  output_artifact_id TEXT
);
