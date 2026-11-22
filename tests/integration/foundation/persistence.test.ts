import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const NOW = "2026-11-22T10:00:00.000Z";
const ACTOR_ID = "018f2d8f-1001-7f20-80b1-aaaaaaaaaaa1";
const WORKSPACE_ID = "018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4";
const LABEL_ID = "018f2d8f-1006-7f20-80b1-aaaaaaaaaaa6";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(
    existsSync(absolute),
    `Phase 2 implementation is missing: ${relativePath}. T014 expects this module to satisfy the foundation contract.`,
  );
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

async function openTestDatabase() {
  const databaseModule = await loadModule("packages/persistence/src/database.ts");
  assert.equal(
    typeof databaseModule.openDatabase,
    "function",
    "packages/persistence/src/database.ts must export openDatabase(options)",
  );
  const directory = await mkdtemp(join(tmpdir(), "unspool-persistence-"));
  const database = await databaseModule.openDatabase({
    filename: join(directory, "runner.sqlite"),
    busyTimeoutMs: 5_000,
  });
  return { database, directory };
}

test("SQLite opens with WAL, foreign-key enforcement, and a busy timeout", async () => {
  const { database, directory } = await openTestDatabase();
  try {
    const journalMode = await database.pragma("journal_mode");
    assert.equal(String(journalMode).toLowerCase(), "wal");

    const foreignKeys = await database.pragma("foreign_keys");
    assert.equal(Number(foreignKeys), 1);

    const busyTimeout = await database.pragma("busy_timeout");
    assert.ok(Number(busyTimeout) >= 5_000);

    await database.execute("CREATE TABLE parent (id TEXT PRIMARY KEY)");
    await database.execute(
      "CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id))",
    );
    await assert.rejects(
      () => database.execute("INSERT INTO child (id, parent_id) VALUES ('c1', 'missing')"),
      /foreign key/i,
    );
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("single-writer queue serializes overlapping writes in submission order", async () => {
  const { database, directory } = await openTestDatabase();
  try {
    const order: string[] = [];
    const delay = (milliseconds: number) =>
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

    const first = database.write(async () => {
      order.push("first:start");
      await delay(25);
      order.push("first:end");
    });
    const second = database.write(async () => {
      order.push("second:start");
      order.push("second:end");
    });
    const third = database.write(async () => {
      order.push("third:start");
      order.push("third:end");
    });

    await Promise.all([first, second, third]);
    assert.deepEqual(order, [
      "first:start",
      "first:end",
      "second:start",
      "second:end",
      "third:start",
      "third:end",
    ]);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("single-writer queue is shared by two connections to the same file", async () => {
  const { database, directory } = await openTestDatabase();
  const databaseModule = await loadModule("packages/persistence/src/database.ts");
  const second = await databaseModule.openDatabase({ filename: join(directory, "runner.sqlite") });
  const startedAt = Date.now();
  try {
    const order: string[] = [];
    const first = database.write(async () => {
      order.push("first:start");
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
      order.push("first:end");
    });
    const overlapping = second.write(async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await Promise.all([first, overlapping]);
    assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
    assert.ok(
      Date.now() - startedAt < 1_000,
      "same-process writers must not hit the SQLite busy timeout",
    );
    await database.write(async () => {
      await database.write(async () => undefined);
    });
  } finally {
    await second.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration journal records checksums and rejects unknown higher schemas", async () => {
  const { database, directory } = await openTestDatabase();
  const migrationsModule = await loadModule("packages/persistence/src/migrations.ts");
  try {
    assert.equal(
      typeof migrationsModule.runMigrations,
      "function",
      "migrations.ts must export runMigrations(database, migrations)",
    );
    assert.equal(
      typeof migrationsModule.assertSupportedSchema,
      "function",
      "migrations.ts must export assertSupportedSchema(database, supportedVersion)",
    );
    assert.ok(
      Array.isArray(migrationsModule.foundationMigrations) &&
        migrationsModule.foundationMigrations.length > 0,
      "migrations.ts must export the canonical foundationMigrations array",
    );

    await migrationsModule.runMigrations(database, migrationsModule.foundationMigrations);
    const firstJournal = await database.query(
      "SELECT version, checksum, applied_at AS appliedAt, backup_manifest_id AS backupManifestId FROM schema_migration ORDER BY version",
    );
    assert.equal(firstJournal.length, migrationsModule.foundationMigrations.length);
    for (const row of firstJournal) {
      assert.ok(Number.isInteger(Number(row.version)));
      assert.match(String(row.checksum), /^sha256:[a-f0-9]{64}$/);
      assert.ok(!Number.isNaN(Date.parse(String(row.appliedAt))));
      assert.equal(row.backupManifestId, null);
    }

    await migrationsModule.runMigrations(database, migrationsModule.foundationMigrations);
    const secondJournal = await database.query("SELECT COUNT(*) AS count FROM schema_migration");
    assert.equal(Number(secondJournal[0].count), migrationsModule.foundationMigrations.length);

    const tampered = migrationsModule.foundationMigrations.map(
      (migration: { version: number; checksum: string; sql: string }, index: number) =>
        index === 0 ? { ...migration, checksum: digest("tampered-migration") } : migration,
    );
    await assert.rejects(() => migrationsModule.runMigrations(database, tampered), /checksum/i);

    const maxVersion = Math.max(
      ...migrationsModule.foundationMigrations.map(
        (migration: { version: number }) => migration.version,
      ),
    );
    await migrationsModule.assertSupportedSchema(database, maxVersion);
    await assert.rejects(
      () => migrationsModule.assertSupportedSchema(database, maxVersion - 1),
      /schema|version/i,
    );
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unit of work commits domain state, event, outbox, and receipt atomically", async () => {
  const { database, directory } = await openTestDatabase();
  const migrationsModule = await loadModule("packages/persistence/src/migrations.ts");
  const unitOfWorkModule = await loadModule("packages/persistence/src/unit-of-work.ts");
  try {
    assert.equal(
      typeof unitOfWorkModule.commitCommandUnitOfWork,
      "function",
      "unit-of-work.ts must export commitCommandUnitOfWork(database, command)",
    );
    await migrationsModule.runMigrations(database, migrationsModule.foundationMigrations);
    await database.execute("PRAGMA foreign_keys = OFF");
    await database.execute(
      "CREATE TABLE foundation_test_state (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );

    const commandId = "018f2d8f-2001-7f20-80b1-bbbbbbbbbbb1";
    const commandDigest = digest("command-1");
    const response = { workspaceId: WORKSPACE_ID, revision: 1 };
    const command = {
      actorId: ACTOR_ID,
      workspaceId: WORKSPACE_ID,
      commandId,
      payloadDigest: commandDigest,
      response,
      mutate: async (transaction: {
        execute: (sql: string, params?: readonly unknown[]) => Promise<void>;
      }) => {
        await transaction.execute("INSERT INTO foundation_test_state (id, value) VALUES (?, ?)", [
          "state-1",
          "one",
        ]);
      },
      events: [
        {
          type: "workspace.updated",
          schemaVersion: 1,
          occurredAt: NOW,
          actorId: ACTOR_ID,
          visibility: { kind: "workspace_members", securityLabelId: LABEL_ID },
          payloadDigest: digest("event-1"),
          payload: { revision: 1 },
        },
      ],
    };

    const first = await unitOfWorkModule.commitCommandUnitOfWork(database, command);
    assert.equal(first.replayed, false);
    assert.deepEqual(first.response, response);
    assert.equal(first.eventIds.length, 1);
    assert.ok(first.outboxMessageIds.length >= 1);

    const events = await database.query(
      "SELECT id, sequence, type, payload_digest AS payloadDigest FROM domain_event ORDER BY sequence",
    );
    assert.equal(events.length, 1);
    assert.equal(Number(events[0].sequence), 1);
    assert.equal(events[0].type, "workspace.updated");
    assert.equal(events[0].payloadDigest, digest("event-1"));
    assert.equal(events[0].id, first.eventIds[0]);

    const outbox = await database.query(
      "SELECT id, domain_event_id AS domainEventId, state, attempt_count AS attemptCount, available_at AS availableAt FROM outbox_message WHERE domain_event_id = ?",
      [first.eventIds[0]],
    );
    assert.ok(outbox.length >= 1);
    assert.equal(outbox[0].state, "pending");
    assert.equal(Number(outbox[0].attemptCount), 0);
    assert.ok(outbox[0].availableAt);
    assert.ok(Date.parse(String(outbox[0].availableAt)) <= Date.parse(NOW));

    const receipts = await database.query(
      "SELECT command_id AS commandId, payload_digest AS payloadDigest, response_digest AS responseDigest FROM command_receipt WHERE actor_id = ? AND command_id = ?",
      [ACTOR_ID, commandId],
    );
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].payloadDigest, commandDigest);
    assert.ok(String(receipts[0].responseDigest).length > 0);

    const replayed = await unitOfWorkModule.commitCommandUnitOfWork(database, command);
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.response, response);
    assert.equal(
      Number((await database.query("SELECT COUNT(*) AS count FROM domain_event"))[0].count),
      1,
    );
    assert.equal(
      Number((await database.query("SELECT COUNT(*) AS count FROM outbox_message"))[0].count),
      1,
    );

    await assert.rejects(
      () =>
        unitOfWorkModule.commitCommandUnitOfWork(database, {
          ...command,
          payloadDigest: digest("different-payload"),
          response: { workspaceId: WORKSPACE_ID, revision: 2 },
        }),
      (error: { code?: string }) => error.code === "revision_conflict",
    );
    assert.equal(
      Number((await database.query("SELECT COUNT(*) AS count FROM domain_event"))[0].count),
      1,
    );

    const second = await unitOfWorkModule.commitCommandUnitOfWork(database, {
      ...command,
      commandId: "018f2d8f-2001-7f20-80b1-bbbbbbbbbbb2",
      payloadDigest: digest("command-2"),
      response: { workspaceId: WORKSPACE_ID, revision: 2 },
      mutate: async (transaction: {
        execute: (sql: string, params?: readonly unknown[]) => Promise<void>;
      }) => {
        await transaction.execute("INSERT INTO foundation_test_state (id, value) VALUES (?, ?)", [
          "state-2",
          "two",
        ]);
      },
      events: [
        {
          type: "workspace.updated",
          schemaVersion: 1,
          occurredAt: NOW,
          actorId: ACTOR_ID,
          visibility: { kind: "workspace_members", securityLabelId: LABEL_ID },
          payloadDigest: digest("event-2"),
          payload: { revision: 2 },
        },
      ],
    });
    assert.equal(second.replayed, false);
    const sequences = await database.query("SELECT sequence FROM domain_event ORDER BY sequence");
    assert.deepEqual(
      sequences.map((row: { sequence: number | bigint }) => Number(row.sequence)),
      [1, 2],
    );

    const eventCountBeforeRollback = Number(
      (await database.query("SELECT COUNT(*) AS count FROM domain_event"))[0].count,
    );
    const outboxCountBeforeRollback = Number(
      (await database.query("SELECT COUNT(*) AS count FROM outbox_message"))[0].count,
    );
    await assert.rejects(() =>
      unitOfWorkModule.commitCommandUnitOfWork(database, {
        ...command,
        commandId: "018f2d8f-2001-7f20-80b1-bbbbbbbbbbb3",
        payloadDigest: digest("command-3"),
        response: { workspaceId: WORKSPACE_ID, revision: 3 },
        mutate: async (transaction: { execute: (sql: string) => Promise<void> }) => {
          await transaction.execute(
            "INSERT INTO foundation_test_state (id, value) VALUES ('state-3', 'three')",
          );
          throw new Error("rollback probe");
        },
        events: [
          {
            type: "workspace.updated",
            schemaVersion: 1,
            occurredAt: NOW,
            actorId: ACTOR_ID,
            visibility: { kind: "workspace_members", securityLabelId: LABEL_ID },
            payloadDigest: digest("event-3"),
            payload: { revision: 3 },
          },
        ],
      }),
    );
    assert.equal(
      Number((await database.query("SELECT COUNT(*) AS count FROM domain_event"))[0].count),
      eventCountBeforeRollback,
    );
    assert.equal(
      Number((await database.query("SELECT COUNT(*) AS count FROM outbox_message"))[0].count),
      outboxCountBeforeRollback,
    );
    assert.equal(
      Number(
        (
          await database.query(
            "SELECT COUNT(*) AS count FROM command_receipt WHERE command_id = ?",
            ["018f2d8f-2001-7f20-80b1-bbbbbbbbbbb3"],
          )
        )[0].count,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await database.query(
            "SELECT COUNT(*) AS count FROM foundation_test_state WHERE id = 'state-3'",
          )
        )[0].count,
      ),
      0,
    );
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
