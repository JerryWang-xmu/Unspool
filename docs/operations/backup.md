# Cold backup and upgrade policy

## When to back up

Back up before every upgrade, before deleting or moving a data directory, and before changing migration or host operating system. Stop the Runner so no writer can race the snapshot. The backup implementation also uses a database-consistent SQLite snapshot plus content-addressed objects and sessions.

## Manifest and integrity

`manifest.json` records app/schema versions, the last workspace event sequence, object/session relative paths, SHA-256 digests, sizes, and its own digest. Object and session files must remain inside their declared `objects/` or `sessions/` directories. Unknown, missing, truncated, or digest-mismatched entries fail closed; no partial restore is reported as successful.

## Procedure

1. Close Runner and worker processes.
2. Call `createColdBackup({ dataDir, backupDir, appVersion, now })` against an empty destination.
3. Verify `manifestPath` and the persisted manifest are identical and the digest validates.
4. Copy the backup to independent storage with owner-only permissions.
5. Verify every object/session entry by digest before restoring.
6. Restore only into an empty target. `restoreColdBackup` refuses a non-empty target and never silently clears existing data.

A newer unsupported database or backup schema is rejected rather than downgraded silently. After restoring, run migrations only through the normal migration journal, then reopen personal history and confirm task/Run/checkpoint/artifact continuity.
