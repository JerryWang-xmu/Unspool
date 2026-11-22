const DEFAULT_INSTANT = "2026-01-01T00:00:00.000Z";

export interface DeterministicClock {
  now(): Date;
  nowIso(): string;
  advance(milliseconds: number): Date;
  set(value: Date | string): Date;
}

const toDate = (value: Date | string): Date => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid clock instant: ${String(value)}`);
  }

  return date;
};

export function createDeterministicClock(
  initial: Date | string = DEFAULT_INSTANT,
): DeterministicClock {
  let current = toDate(initial);

  return {
    now: () => new Date(current.getTime()),
    nowIso: () => current.toISOString(),
    advance(milliseconds: number): Date {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new RangeError(`Clock advance must be a finite non-negative value: ${milliseconds}`);
      }

      current = toDate(new Date(current.getTime() + milliseconds));
      return new Date(current.getTime());
    },
    set(value: Date | string): Date {
      current = toDate(value);
      return new Date(current.getTime());
    },
  };
}
