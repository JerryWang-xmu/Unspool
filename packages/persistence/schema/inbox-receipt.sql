CREATE TABLE IF NOT EXISTS inbox_receipt (
  consumer_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  PRIMARY KEY (consumer_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_receipt_message ON inbox_receipt(message_id);
