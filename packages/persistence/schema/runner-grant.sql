CREATE TABLE IF NOT EXISTS runner_grant (
  runner_id TEXT NOT NULL,
  team_id TEXT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'team')),
  subject_id TEXT NOT NULL,
  allowed_policy TEXT NOT NULL,
  PRIMARY KEY (runner_id, subject_type, subject_id),
  FOREIGN KEY (runner_id) REFERENCES runner(id),
  CHECK ((subject_type = 'user' AND team_id IS NULL) OR (subject_type = 'team' AND team_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_runner_grant_subject ON runner_grant(subject_type, subject_id);
