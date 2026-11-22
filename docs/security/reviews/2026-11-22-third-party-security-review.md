# Independent architecture/security review — 2026-11-22

## Reviewer model

A separate fresh read-only review session examined a different implementation slice from the threat-model reviewer. It did not modify files and did not execute the application. “Third-party” here means independent reviewer context, not an external vendor assessment.

## Scope

Handoff/private preparation, evidence impact, archive, federation, guarded tool execution, backup/restore, and the pi approval gate.

## Original findings

1. **HIGH — Permit single-use needed an atomic persistence contract.** Separate load/check/save could permit concurrent authorization unless the store provided conditional consumption.
2. **HIGH — Ticket replay and Grant limits crossed process boundaries.** In-memory replay state disappeared on restart and usage limits were not consumed atomically.
3. **HIGH — Cold restore could authenticate incomplete state.** SQLite bytes were not manifest-bound, unlisted directory contents could be copied, and SQLite integrity was not checked.
4. **HIGH — Snapshot paths were vulnerable to ancestor symlinks and check/read replacement.** A lexical root check and final-component `lstat` were insufficient.
5. **HIGH — Evidence inspection invented a benign pending result.** Unknown or unresolved actions could be shown as `pending`, `executed: false` without loading actual state.

## Controls verified as sound in the original scoped review

- Private preparation answers pass through recipient-only access, and private QA is not emitted onto workspace events.
- Publication emits only the explicitly edited body.
- The guarded wrapper persists `outcome_unknown` before invocation and does not automatically replay failed, lost, or unresolved execution.
- Federated recovery disables automatic replay for dispatched, incomplete work.

## Remediation and test evidence

- `createSqliteApprovalGate` now supplies durable approval loading, conditional atomic consumption, and outcome-only finalization. The production Permit path requires this atomic operation rather than a non-atomic save fallback.
- The persistence layer shares an asynchronous writer queue per canonical database file. An independent failure investigation proved that the prior same-process two-connection behavior was a synchronous SQLite busy-handler stall, not a Permit policy bypass. The fix does not translate `SQLITE_BUSY` into `already_consumed`.
- Ticket consumption persists request/nonce/execution uniqueness and enforces Grant usage/maxOperations in the final write transaction.
- Backup restore validates database size/digest and entry size/digest, rejects non-regular/symlinked content, restores only the listed file set, and checks SQLite integrity.
- Snapshot creation rejects every symlink component and validates the opened file and final path/inode.
- Pending-action inspection returns actual registered state or `not_found`.

## Disposition

The original review was **NO-GO**. The concrete implementation findings have targeted remediation and executable regressions, but this document alone does not establish that every CRITICAL/HIGH issue is independently closed.

Remaining release blockers include Docker runtime bypass verification, production-scope persistent federation/evidence stores, real B1 process/filesystem/transport validation, Node 24 release verification, and a successful independent post-remediation review. The attempted later review was unavailable because of reviewer quota limits; no replacement certification is asserted.
