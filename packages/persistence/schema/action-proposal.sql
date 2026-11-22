-- ActionProposal keeps canonical_args only for the controlled execution boundary.
-- Approval queries must select display_args and secret_refs, never canonical_args.
CREATE TABLE action_proposal (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES run(id),
  attempt_id TEXT NOT NULL REFERENCES run_attempt(id),
  tool_call_id TEXT NOT NULL REFERENCES tool_call_record(id),
  tool_name TEXT NOT NULL,
  canonical_args TEXT NOT NULL CHECK (json_valid(canonical_args)),
  display_args TEXT NOT NULL CHECK (
    json_valid(display_args) AND json_type(display_args) = 'object'
  ),
  secret_refs TEXT NOT NULL CHECK (
    json_valid(secret_refs) AND json_type(secret_refs) = 'array'
  ),
  action_digest TEXT NOT NULL CHECK (
    length(action_digest) = 71
    AND action_digest GLOB 'sha256:*'
    AND substr(action_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  purpose TEXT NOT NULL,
  impact TEXT NOT NULL,
  risk TEXT NOT NULL,
  base_resource_versions TEXT NOT NULL CHECK (
    json_valid(base_resource_versions) AND json_type(base_resource_versions) = 'array'
  ),
  created_at TEXT NOT NULL
);

CREATE INDEX action_proposal_run_idx ON action_proposal (run_id, created_at);
CREATE INDEX action_proposal_attempt_idx ON action_proposal (attempt_id);
CREATE INDEX action_proposal_tool_call_idx ON action_proposal (tool_call_id);
