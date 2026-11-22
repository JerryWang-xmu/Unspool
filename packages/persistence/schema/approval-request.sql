-- ApprovalRequest starts pending, defaults to a 15-minute deadline in the
-- application layer, and cannot leave a terminal state.
CREATE TABLE approval_request (
  id TEXT PRIMARY KEY NOT NULL,
  action_proposal_id TEXT NOT NULL REFERENCES action_proposal(id),
  requester_id TEXT NOT NULL,
  required_approver_policy TEXT NOT NULL CHECK (
    json_valid(required_approver_policy) AND json_type(required_approver_policy) = 'object'
  ),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'approved', 'rejected', 'expired', 'invalidated')
  ),
  expires_at TEXT NOT NULL,
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX approval_request_proposal_idx ON approval_request (action_proposal_id);
CREATE INDEX approval_request_state_idx ON approval_request (state, expires_at);
CREATE INDEX approval_request_requester_idx ON approval_request (requester_id, created_at);
