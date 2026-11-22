CREATE TABLE IF NOT EXISTS federation_ticket_consumption (
  request_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  execution_id TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_federation_ticket_grant ON federation_ticket_consumption(grant_id, consumed_at);
