CREATE TABLE IF NOT EXISTS collaboration_metric (
  week TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  value REAL NOT NULL CHECK (value >= 0),
  calculation_version TEXT NOT NULL,
  PRIMARY KEY (week, metric_name, subject_id, calculation_version)
);

CREATE INDEX IF NOT EXISTS idx_collaboration_metric_name ON collaboration_metric(metric_name, week);
