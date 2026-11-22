# Recovery and failure handling

## Restore checklist

1. Stop all Runner/worker processes and isolate the target host from users.
2. Verify the backup manifest, schema compatibility, and every object/session digest before writing anything.
3. Restore into an empty host data directory. Existing targets are never overwritten.
4. Reopen the repository and check recent tasks, exact conversation IDs, latest Runs, session checkpoints, and artifact bytes.
5. Start the Runner in a fenced validation state first. Non-terminal live runs, entered-but-unfinalized tools, and uncertain side effects become `needs_confirmation`; never auto-replay them.
6. Reconcile `Last-Event-ID`, checkpoints, pi leaf IDs, and withheld queues before enabling new commands.

## Common failures

- **Missing object/session**: restoration fails with `backup_invalid` and names the missing item.
- **Digest mismatch**: expected and actual digests are reported; the target remains untouched.
- **Non-empty target**: returns `target_not_empty`; choose a new directory.
- **Newer schema**: upgrade the Runner only after reading the migration/upgrade guide and taking a compatible backup.
- **Unknown execution outcome**: inspect the real file/external system. A consumed Permit is never reused and queued instructions remain withheld until a human chooses an action.
- **Slow/offline client**: replay from the last committed workspace sequence; private/hidden events advance cursors without exposing their payloads.

Record every recovery operation in `artifacts/validation/` with command, result, and relevant hashes, but never record secrets or private message bodies.
