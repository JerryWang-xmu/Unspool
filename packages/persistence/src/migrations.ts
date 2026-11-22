import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SqliteDatabase } from "./database.js";

export interface MigrationDefinition {
  readonly version: number;
  readonly checksum: string;
  readonly sql: string;
}

const SCHEMA_MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version INTEGER PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    backup_manifest_id TEXT
  )
`;

export function migrationChecksum(sql: string): string {
  return `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`;
}

function migration(version: number, sql: string): MigrationDefinition {
  return { version, checksum: migrationChecksum(sql), sql };
}

function migrationFromFile(version: number, filename: string): MigrationDefinition {
  return migration(
    version,
    readFileSync(new URL(`../schema/${filename}`, import.meta.url), "utf8"),
  );
}

export const foundationMigrations: readonly MigrationDefinition[] = [
  migrationFromFile(1, "schema-migration.sql"),
  migrationFromFile(2, "command-receipt.sql"),
  migrationFromFile(3, "user.sql"),
  migrationFromFile(4, "runner.sql"),
  migrationFromFile(5, "runner-grant.sql"),
  migrationFromFile(6, "model-profile.sql"),
  migrationFromFile(7, "workspace.sql"),
  migrationFromFile(8, "workspace-member.sql"),
  migrationFromFile(9, "workspace-control.sql"),
  migrationFromFile(10, "domain-event.sql"),
  migrationFromFile(11, "transient-output.sql"),
  migrationFromFile(12, "outbox-message.sql"),
  migrationFromFile(13, "inbox-receipt.sql"),
  migrationFromFile(14, "attribution.sql"),
  migrationFromFile(15, "security-label.sql"),
  migrationFromFile(16, "blob-object.sql"),
  migrationFromFile(17, "artifact-version.sql"),
  migrationFromFile(18, "backup-manifest.sql"),
  migrationFromFile(19, "suggestion-decision.sql"),
  migrationFromFile(20, "share-preview.sql"),
  migrationFromFile(21, "share-conversion.sql"),
  migrationFromFile(22, "analytics-event.sql"),
  migrationFromFile(23, "collaboration-metric.sql"),
  migrationFromFile(24, "agent-conversation.sql"),
  migrationFromFile(25, "task-context-snapshot.sql"),
  migrationFromFile(26, "run.sql"),
  migrationFromFile(27, "session-checkpoint.sql"),
  migrationFromFile(28, "run-attempt.sql"),
  migrationFromFile(29, "run-command.sql"),
  migrationFromFile(30, "queued-instruction.sql"),
  migrationFromFile(31, "usage-record.sql"),
  migrationFromFile(32, "completion-assessment.sql"),
  migrationFromFile(33, "input-item.sql"),
  migrationFromFile(34, "tool-call-record.sql"),
  migrationFromFile(35, "artifact-metadata.sql"),
  migrationFromFile(36, "action-proposal.sql"),
  migrationFromFile(37, "approval-request.sql"),
  migrationFromFile(38, "approval-decision.sql"),
  migrationFromFile(39, "execution-permit.sql"),
  migrationFromFile(40, "team.sql"),
  migrationFromFile(41, "membership.sql"),
  migrationFromFile(42, "context-item.sql"),
  migrationFromFile(43, "context-version.sql"),
  migrationFromFile(44, "handoff-summary.sql"),
  migrationFromFile(45, "handoff-invitation.sql"),
  migrationFromFile(46, "preparation-session.sql"),
  migrationFromFile(47, "private-qa.sql"),
  migrationFromFile(48, "citation.sql"),
  migrationFromFile(49, "unresolved-issue.sql"),
  migrationFromFile(50, "clarification-publication.sql"),
  migrationFromFile(51, "workspace-presence.sql"),
  migrationFromFile(52, "conclusion.sql"),
  migrationFromFile(53, "evidence-source.sql"),
  migrationFromFile(54, "source-version.sql"),
  migrationFromFile(55, "evidence-link.sql"),
  migrationFromFile(56, "conclusion-impact.sql"),
  migrationFromFile(57, "review-record.sql"),
  migrationFromFile(58, "evidence-exception.sql"),
  migrationFromFile(59, "archive-export.sql"),
  migrationFromFile(61, "federation-ticket-consumption.sql"),
  migrationFromFile(62, "federation-grant-state.sql"),
  migrationFromFile(63, "approval-audit.sql"),
  migrationFromFile(64, "permit-outcome-finalization.sql"),
];

export const CURRENT_SCHEMA_VERSION = Math.max(
  ...foundationMigrations.map((migrationRecord) => migrationRecord.version),
);

export class UnsupportedSchemaError extends Error {
  readonly code = "unsupported_schema_version";

  constructor(currentVersion: number, supportedVersion: number) {
    super(
      `Unsupported database schema version ${currentVersion}; this build supports up to schema version ${supportedVersion}.`,
    );
    this.name = "UnsupportedSchemaError";
  }
}

function assertMigrationShape(migrationRecord: MigrationDefinition): void {
  if (!Number.isInteger(migrationRecord.version) || migrationRecord.version < 1) {
    throw new TypeError(`Migration version must be a positive integer: ${migrationRecord.version}`);
  }
  if (migrationRecord.checksum !== migrationChecksum(migrationRecord.sql)) {
    throw new Error(
      `Migration ${migrationRecord.version} checksum does not match its SQL; refusing to apply tampered migration.`,
    );
  }
}

export async function runMigrations(
  database: SqliteDatabase,
  migrations: readonly MigrationDefinition[],
): Promise<void> {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();
  for (const migrationRecord of ordered) {
    assertMigrationShape(migrationRecord);
    if (versions.has(migrationRecord.version)) {
      throw new Error(`Duplicate migration version: ${migrationRecord.version}`);
    }
    versions.add(migrationRecord.version);
  }

  await database.execute(SCHEMA_MIGRATION_TABLE);

  for (const migrationRecord of ordered) {
    await database.write(async (transaction) => {
      const applied = await transaction.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migration WHERE version = ?",
        [migrationRecord.version],
      );
      if (applied.length > 0) {
        if (applied[0]?.checksum !== migrationRecord.checksum) {
          throw new Error(
            `Migration ${migrationRecord.version} checksum mismatch with the applied journal.`,
          );
        }
        return;
      }

      await transaction.executeScript(migrationRecord.sql);
      await transaction.execute(
        `INSERT INTO schema_migration (version, checksum, applied_at, backup_manifest_id)
         VALUES (?, ?, ?, NULL)`,
        [migrationRecord.version, migrationRecord.checksum, new Date().toISOString()],
      );
    });
  }
}

export async function assertSupportedSchema(
  database: SqliteDatabase,
  supportedVersion: number,
): Promise<void> {
  if (!Number.isInteger(supportedVersion) || supportedVersion < 0) {
    throw new TypeError(
      `Supported schema version must be a non-negative integer: ${supportedVersion}`,
    );
  }

  const journal = await database.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration'",
  );
  if (journal.length === 0) {
    if (supportedVersion < 0) {
      throw new UnsupportedSchemaError(0, supportedVersion);
    }
    return;
  }

  const current = await database.query<{ version: number | null }>(
    "SELECT MAX(version) AS version FROM schema_migration",
  );
  const currentVersion = Number(current[0]?.version ?? 0);
  if (currentVersion > supportedVersion) {
    throw new UnsupportedSchemaError(currentVersion, supportedVersion);
  }
}
