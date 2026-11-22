-- Run (data-model.md section 4).
-- state is technical execution state only. The manual CompletionAssessment is a
-- separate entity and must never be collapsed into run.state or this table.
CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  state TEXT NOT NULL CHECK (
    state IN (
      'created',
      'running',
      'waiting_approval',
      'stopping',
      'technical_complete',
      'failed',
      'cancelled',
      'needs_confirmation'
    )
  ),
  operator_epoch INTEGER NOT NULL CHECK (operator_epoch >= 1),
  runner_id TEXT NOT NULL,
  context_snapshot_id TEXT NOT NULL,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  ended_at TEXT,
  last_known_checkpoint TEXT,
  UNIQUE (workspace_id, sequence),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (conversation_id) REFERENCES agent_conversation(id),
  FOREIGN KEY (runner_id) REFERENCES runner(id),
  FOREIGN KEY (context_snapshot_id) REFERENCES task_context_snapshot(id),
  FOREIGN KEY (started_by) REFERENCES user(id),
  FOREIGN KEY (last_known_checkpoint) REFERENCES session_checkpoint(id)
);

-- At most one active Run per workspace. needs_confirmation stays active so an
-- unknown outcome cannot be bypassed by starting a second Run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_one_active_per_workspace
  ON run (workspace_id)
  WHERE state IN ('created', 'running', 'waiting_approval', 'stopping', 'needs_confirmation');

CREATE INDEX IF NOT EXISTS idx_run_conversation
  ON run (conversation_id, sequence);
