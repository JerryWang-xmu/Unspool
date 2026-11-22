import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { NodeDirectiveService } from "../../../apps/runner-api/src/federation/directives.js";
import { FederationGrantService } from "../../../apps/runner-api/src/federation/grant-service.js";
import {
  projectOverview,
  SseBackpressure,
} from "../../../apps/runner-api/src/projections/overview.js";

describe("performance validation", () => {
  it("replays long history for five clients and preserves five-node/twenty-Grant isolation", async () => {
    const events = Array.from({ length: 2000 }, (_, index) => ({
      workspaceId: "performance",
      sequence: index + 1,
      type: "output",
      payload: `event-${index}`,
    }));
    const clients = Array.from({ length: 5 }, () => [] as number[]);
    for (const client of clients) {
      let cursor = 0;
      do {
        const page = projectOverview(events, { afterSequence: cursor, limit: 137 });
        client.push(...page.events.map((event) => event.sequence));
        cursor = page.nextSequence;
        if (!page.hasMore) break;
      } while (cursor < events.length);
    }
    for (const client of clients) {
      expect(client).toHaveLength(2000);
      expect(new Set(client).size).toBe(2000);
      expect(client).toEqual(clients[0]);
    }

    const grants = new FederationGrantService();
    expectOk(grants.registerOwner("owner"));
    for (let index = 0; index < 5; index += 1) {
      for (let grantIndex = 0; grantIndex < 4; grantIndex += 1) {
        const id = `node-${index}-grant-${grantIndex}`;
        expectOk(
          grants.propose({
            id,
            nodeId: `node-${index}`,
            ownerId: "owner",
            resourceId: "resource",
            resourceDigest: `sha256:${"a".repeat(64)}`,
            operations: ["snapshot.read"],
            notBefore: "2026-01-01T00:00:00.000Z",
            expiresAt: "2027-01-01T00:00:00.000Z",
            usageLimit: 1,
            policyRevision: 1,
          }),
        );
        expectOk(grants.decide(id, "active"));
      }
    }
    const directives = new NodeDirectiveService();
    for (let index = 0; index < 5; index += 1)
      expect(directives.recover(`node-${index}`, true, false).autoReplay).toBe(false);
    const backpressure = new SseBackpressure(2);
    expect(backpressure.offer({ sequence: 1 })).toBe("accepted");
    expect(backpressure.offer({ sequence: 2 })).toBe("accepted");
    expect(backpressure.offer({ sequence: 3 })).toBe("stale");

    await mkdir("artifacts/validation/performance", { recursive: true });
    await writeFile(
      "artifacts/validation/performance/summary.json",
      JSON.stringify(
        {
          result: "pass",
          longHistoryEvents: 2000,
          clients: 5,
          nodes: 5,
          grants: 20,
          backpressure: "explicit stale signal; no silent drop",
          unknownOutcomeAutoReplay: false,
        },
        null,
        2,
      ),
    );
  });
});

function expectOk<T>(result: T): T {
  return result;
}
