import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationTicketService } from "../../../apps/runner-api/src/federation/operation-tickets.js";
import { SqliteTicketConsumptionStore } from "../../../apps/runner-api/src/federation/ticket-store.js";
import { openDatabase } from "../../../packages/persistence/src/database.js";
import {
  foundationMigrations,
  runMigrations,
} from "../../../packages/persistence/src/migrations.js";
import { createB0FederationFixture } from "../../../packages/test-support/src/federation/fixtures.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("federation ticket durable single-use", () => {
  it("rejects a valid ticket after reopening the consumption store", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-ticket-store-"));
    directories.push(dataDir);
    const database = await openDatabase({ filename: join(dataDir, "unspool.sqlite") });
    await runMigrations(database, foundationMigrations);
    await database.close();
    const fixture = await createB0FederationFixture();
    try {
      const firstStore = new SqliteTicketConsumptionStore(join(dataDir, "unspool.sqlite"));
      const first = new OperationTicketService(() => new Date(fixture.now), firstStore);
      const accepted = first.accept({
        ticket: fixture.tickets.valid,
        grant: fixture.grants.active,
        recipientDigest: fixture.tickets.valid.recipientDigest,
        bodyDigest: fixture.tickets.valid.bodyDigest,
        grantDigest: fixture.tickets.valid.grantDigest,
        actionDigest: fixture.tickets.valid.actionDigest,
        verifySignature: () => true,
        verifyGrant: () => true,
      });
      expect(accepted.oneTime).toBe(true);
      firstStore.close();
      const secondStore = new SqliteTicketConsumptionStore(join(dataDir, "unspool.sqlite"));
      const second = new OperationTicketService(() => new Date(fixture.now), secondStore);
      expect(() =>
        second.accept({
          ticket: fixture.tickets.valid,
          grant: fixture.grants.active,
          recipientDigest: fixture.tickets.valid.recipientDigest,
          bodyDigest: fixture.tickets.valid.bodyDigest,
          grantDigest: fixture.tickets.valid.grantDigest,
          actionDigest: fixture.tickets.valid.actionDigest,
          verifySignature: () => true,
          verifyGrant: () => true,
        }),
      ).toThrow(/ticket_replay_denied|grant_exhausted/);
      expect(secondStore.usageCount(fixture.grants.active.id)).toBe(1);
      secondStore.close();
    } finally {
      await fixture.cleanup();
    }
  });
});
