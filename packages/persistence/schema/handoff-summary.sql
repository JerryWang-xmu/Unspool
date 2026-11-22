CREATE TABLE IF NOT EXISTS handoff_summary (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  goal TEXT NOT NULL,
  criteria TEXT NOT NULL,
  run_state TEXT NOT NULL,
  decisions TEXT NOT NULL CHECK (json_valid(decisions)),
  completed_work TEXT NOT NULL CHECK (json_valid(completed_work)),
  pending_approval_ids TEXT NOT NULL CHECK (json_valid(pending_approval_ids)),
  queue_ids TEXT NOT NULL CHECK (json_valid(queue_ids)),
  todo_ids TEXT NOT NULL CHECK (json_valid(todo_ids)),
  artifact_ids TEXT NOT NULL CHECK (json_valid(artifact_ids)),
  blockers TEXT NOT NULL CHECK (json_valid(blockers)),
  grant_ids TEXT NOT NULL CHECK (json_valid(grant_ids))
);
CREATE TRIGGER IF NOT EXISTS handoff_summary_no_update BEFORE UPDATE ON handoff_summary BEGIN SELECT RAISE(ABORT, 'handoff_summary is immutable'); END;
CREATE TRIGGER IF NOT EXISTS handoff_summary_no_delete BEFORE DELETE ON handoff_summary BEGIN SELECT RAISE(ABORT, 'handoff_summary is immutable'); END;
