-- An ExecutionPermit is consumed once, immediately before the tool entry point.
-- Unknown execution outcomes still consume the permit and cannot be replayed.
CREATE TABLE execution_permit (
  id TEXT PRIMARY KEY NOT NULL,
  approval_decision_id TEXT NOT NULL REFERENCES approval_decision(id),
  action_digest TEXT NOT NULL CHECK (
    length(action_digest) = 71
    AND action_digest GLOB 'sha256:*'
    AND substr(action_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  run_attempt_id TEXT NOT NULL REFERENCES run_attempt(id),
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 0),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumption_result TEXT,
  CHECK (
    (consumed_at IS NULL AND consumption_result IS NULL)
    OR (consumed_at IS NOT NULL AND consumption_result IS NOT NULL)
  )
);

CREATE INDEX execution_permit_decision_idx ON execution_permit (approval_decision_id);
CREATE INDEX execution_permit_attempt_idx ON execution_permit (run_attempt_id);
CREATE INDEX execution_permit_digest_idx ON execution_permit (action_digest);

CREATE TRIGGER execution_permit_single_use
BEFORE UPDATE OF consumed_at, consumption_result ON execution_permit
WHEN OLD.consumed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'execution_permit_already_consumed');
END;
