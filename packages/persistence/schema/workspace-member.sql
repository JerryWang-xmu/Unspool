CREATE TABLE IF NOT EXISTS workspace_member (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator', 'contributor', 'observer')),
  can_approve INTEGER NOT NULL CHECK (can_approve IN (0, 1)),
  can_review INTEGER NOT NULL CHECK (can_review IN (0, 1)),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id),
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_member_user ON workspace_member(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_member_role ON workspace_member(workspace_id, role);
