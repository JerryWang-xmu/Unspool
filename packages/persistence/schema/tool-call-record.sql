CREATE TABLE IF NOT EXISTS tool_call_record (
  id TEXT PRIMARY KEY,
  run_attempt_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  parent_tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  original_args_digest TEXT NOT NULL,
  effective_args_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preflight', 'waiting_approval', 'dispatched', 'succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown')),
  preflight_at TEXT NOT NULL,
  execution_entered_at TEXT,
  finalized_at TEXT,
  result_digest TEXT,
  transcript_entry_id TEXT,
  UNIQUE (run_attempt_id, tool_call_id),
  FOREIGN KEY (run_attempt_id) REFERENCES run_attempt(id),
  FOREIGN KEY (run_attempt_id, parent_tool_call_id) REFERENCES tool_call_record(run_attempt_id, tool_call_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((state IN ('preflight', 'waiting_approval') AND execution_entered_at IS NULL) OR (state NOT IN ('preflight', 'waiting_approval') AND execution_entered_at IS NOT NULL)),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND finalized_at IS NOT NULL) OR (state IN ('preflight', 'waiting_approval', 'dispatched', 'outcome_unknown') AND finalized_at IS NULL)
));

CREATE INDEX IF NOT EXISTS idx_tool_call_record_parent ON tool_call_record(run_attempt_id, parent_tool_call_id);
CREATE INDEX IF NOT EXISTS idx_tool_call_record_state ON tool_call_record(state);
