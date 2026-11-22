-- ApprovalDecision is the terminal decision record for an approval request.
-- Self-approval exceptions are preserved in the decision/audit trail.
CREATE TABLE approval_decision (
  id TEXT PRIMARY KEY NOT NULL,
  approval_request_id TEXT NOT NULL REFERENCES approval_request(id),
  decision TEXT NOT NULL CHECK (
    decision IN ('approved', 'rejected', 'expired', 'invalidated')
  ),
  decided_by TEXT NOT NULL,
  reason TEXT,
  decided_at TEXT NOT NULL,
  action_digest TEXT NOT NULL CHECK (
    length(action_digest) = 71
    AND action_digest GLOB 'sha256:*'
    AND substr(action_digest, 8) NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE INDEX approval_decision_request_idx ON approval_decision (approval_request_id, decided_at);
