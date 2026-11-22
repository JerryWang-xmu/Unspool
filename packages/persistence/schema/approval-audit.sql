CREATE TABLE IF NOT EXISTS approval_audit (
  approval_request_id TEXT PRIMARY KEY REFERENCES approval_request(id),
  actor_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  self_approval_exception_used INTEGER NOT NULL CHECK (self_approval_exception_used IN (0, 1)),
  exception_approved_by TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_decision_request ON approval_decision(approval_request_id);
