CREATE TABLE IF NOT EXISTS conclusion_impact (
  id TEXT PRIMARY KEY,
  conclusion_id TEXT NOT NULL REFERENCES conclusion(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('conclusion', 'completion_criterion', 'artifact', 'pending_action')),
  target_id TEXT NOT NULL,
  impact_kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('review_required', 'resolved')),
  UNIQUE (conclusion_id, target_type, target_id, impact_kind)
);
CREATE INDEX IF NOT EXISTS idx_conclusion_impact_target ON conclusion_impact(target_type, target_id, state);
