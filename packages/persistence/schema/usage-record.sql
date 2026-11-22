CREATE TABLE IF NOT EXISTS usage_record (
  run_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_amount REAL,
  cost_currency TEXT,
  reliability TEXT NOT NULL CHECK (reliability IN ('reliable', 'unavailable')),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (cost_amount IS NULL OR cost_amount >= 0),
  CHECK (cost_currency IS NULL OR length(cost_currency) = 3),
  CHECK ((cost_amount IS NULL) = (cost_currency IS NULL)),
  CHECK (reliability = 'reliable' OR (input_tokens IS NULL AND output_tokens IS NULL AND cost_amount IS NULL AND cost_currency IS NULL)
));
