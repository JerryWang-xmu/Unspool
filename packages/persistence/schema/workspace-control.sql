CREATE TABLE IF NOT EXISTS workspace_control (
  workspace_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  operator_epoch INTEGER NOT NULL CHECK (operator_epoch >= 1),
  active_run_id TEXT,
  active_run_epoch INTEGER NOT NULL CHECK (active_run_epoch >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (operator_id) REFERENCES user(id)
);
