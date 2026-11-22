-- QueuedInstruction (data-model.md section 4).
-- Unspool owns instruction identity and FIFO order: id plus (run_id, position)
-- are the keys. body is intentionally not unique; duplicate text is not a
-- correlation key. A stop transitions rows to 'withheld' explicitly and no
-- trigger/default may release them automatically.
CREATE TABLE IF NOT EXISTS queued_instruction (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  source_command_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('steer', 'follow_up')),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (
    state IN ('queued', 'withheld', 'modified', 'deleted', 'released')
  ),
  position INTEGER NOT NULL CHECK (position >= 1),
  dequeued_at TEXT,
  persisted_at TEXT,
  UNIQUE (source_command_id),
  UNIQUE (run_id, position),
  FOREIGN KEY (run_id) REFERENCES run(id),
  FOREIGN KEY (source_command_id) REFERENCES run_command(id),
  CHECK (persisted_at IS NULL OR dequeued_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_queued_instruction_fifo
  ON queued_instruction (run_id, state, position);
