CREATE TABLE IF NOT EXISTS security_label (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  purpose_rules TEXT NOT NULL,
  member_rules TEXT NOT NULL,
  model_recipient_rules TEXT NOT NULL,
  target_domain_rules TEXT NOT NULL,
  public_visibility INTEGER NOT NULL CHECK (public_visibility IN (0, 1)),
  cache_and_retention TEXT NOT NULL,
  untrusted_content INTEGER NOT NULL CHECK (untrusted_content IN (0, 1)),
  review_history TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_label_public ON security_label(public_visibility);
