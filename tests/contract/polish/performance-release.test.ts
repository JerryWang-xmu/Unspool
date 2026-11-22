import { describe, expect, it } from "vitest";
import {
  coalesceOutputs,
  projectOverview,
  SseBackpressure,
} from "../../../apps/runner-api/src/projections/overview.js";
import {
  assertReleaseEvidence,
  validationCaseCounts,
} from "../../../apps/runner-api/src/statistics/release-evidence.js";

describe("Polish performance and release contracts", () => {
  it("projects long history by keyset and coalesces output without replay", () => {
    const events = Array.from({ length: 250 }, (_, index) => ({
      workspaceId: "w",
      sequence: index + 1,
      type: "output",
      payload: `chunk-${index % 3}`,
    }));
    const page = projectOverview(events, { afterSequence: 100, limit: 50 });
    expect(page.events).toHaveLength(50);
    expect(page.events[0]?.sequence).toBe(101);
    expect(page.nextSequence).toBe(150);
    expect(
      coalesceOutputs([
        { type: "output", text: "a" },
        { type: "output", text: "b" },
        { type: "state", text: "c" },
      ]),
    ).toEqual([
      { type: "output", text: "ab" },
      { type: "state", text: "c" },
    ]);
  });

  it("applies slow-client backpressure with an explicit stale signal", () => {
    const backpressure = new SseBackpressure(2);
    expect(backpressure.offer({ sequence: 1 })).toBe("accepted");
    expect(backpressure.offer({ sequence: 2 })).toBe("accepted");
    expect(backpressure.offer({ sequence: 3 })).toBe("stale");
    expect(backpressure.offer({ sequence: 4 })).toBe("stale");
  });

  it("requires every validation case and rejects skipped evidence", () => {
    expect(validationCaseCounts()).toEqual({ uat: 60, to: 13, t: 20 });
    expect(() => assertReleaseEvidence(new Set(["UAT-01"]))).toThrow(/missing/);
  });
});
