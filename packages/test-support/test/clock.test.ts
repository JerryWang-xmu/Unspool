import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDeterministicClock } from "../src/clock.js";

const START = Date.parse("2026-01-01T00:00:00.000Z");

describe("createDeterministicClock", () => {
  it("advances by exactly the requested non-negative durations", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 50 }), (steps) => {
        const clock = createDeterministicClock();
        let expected = START;

        for (const step of steps) {
          expected += step;
          expect(clock.advance(step).getTime()).toBe(expected);
        }

        expect(clock.now().getTime()).toBe(expected);
        expect(clock.nowIso()).toBe(new Date(expected).toISOString());
      }),
    );
  });

  it("returns defensive copies so callers cannot mutate clock state", () => {
    const clock = createDeterministicClock();
    const first = clock.now();
    first.setUTCFullYear(2030);

    expect(clock.nowIso()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects negative, non-finite, and invalid instants", () => {
    const clock = createDeterministicClock();

    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => clock.set("not-a-date")).toThrow(RangeError);
  });
});
