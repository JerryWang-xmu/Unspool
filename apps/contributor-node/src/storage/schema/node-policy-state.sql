CREATE TABLE IF NOT EXISTS node_policy_state (
  node_id TEXT PRIMARY KEY,
  state_revision INTEGER NOT NULL CHECK (state_revision >= 0),
  beta_enabled INTEGER NOT NULL CHECK (beta_enabled IN (0, 1)),
  pause_state TEXT NOT NULL,
  quarantine_state TEXT NOT NULL,
  revocation_tombstones TEXT NOT NULL CHECK (json_valid(revocation_tombstones)),
  denied_intent_digests TEXT NOT NULL CHECK (json_valid(denied_intent_digests)),
  budget_watermarks TEXT NOT NULL CHECK (json_valid(budget_watermarks))
);
