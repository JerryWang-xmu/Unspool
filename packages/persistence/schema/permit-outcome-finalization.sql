-- A consumed permit may record its final tool outcome exactly once. The
-- consumed timestamp is immutable, consumption cannot be cleared, and an
-- already-final outcome cannot be rewritten or replayed.
DROP TRIGGER IF EXISTS execution_permit_single_use;

CREATE TRIGGER execution_permit_single_use
BEFORE UPDATE OF consumed_at, consumption_result ON execution_permit
WHEN OLD.consumed_at IS NOT NULL
  AND NOT (
    NEW.consumed_at IS OLD.consumed_at
    AND OLD.consumption_result = 'outcome_unknown'
    AND NEW.consumption_result IN ('succeeded', 'failed', 'cancelled', 'timed_out')
  )
BEGIN
  SELECT RAISE(ABORT, 'execution_permit_already_consumed');
END;
