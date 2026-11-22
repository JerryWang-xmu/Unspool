CREATE TABLE IF NOT EXISTS model_profile (
  id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_options TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  FOREIGN KEY (runner_id) REFERENCES runner(id)
);

CREATE INDEX IF NOT EXISTS idx_model_profile_runner_enabled ON model_profile(runner_id, enabled);
