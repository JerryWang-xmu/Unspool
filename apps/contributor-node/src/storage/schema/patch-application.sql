CREATE TABLE IF NOT EXISTS patch_application (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  independent_grant_id TEXT NOT NULL,
  precondition_digests TEXT NOT NULL CHECK (json_valid(precondition_digests)),
  journal_ref TEXT NOT NULL,
  result_by_file TEXT NOT NULL CHECK (json_valid(result_by_file)),
  applied_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
