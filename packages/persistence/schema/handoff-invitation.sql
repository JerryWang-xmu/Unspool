CREATE TABLE IF NOT EXISTS handoff_invitation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  from_operator_id TEXT NOT NULL REFERENCES user(id),
  recipient_id TEXT NOT NULL REFERENCES user(id),
  summary_snapshot_id TEXT NOT NULL REFERENCES handoff_summary(id),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('invited', 'preparing', 'accepted', 'rejected', 'cancelled', 'expired')),
  reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_handoff_invitation_recipient ON handoff_invitation(recipient_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_handoff_invitation_workspace ON handoff_invitation(workspace_id, created_at);
