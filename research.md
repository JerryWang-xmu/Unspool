# Implementation research and decision log

## Confirmed architecture

- Tauri 2 + React desktop, Node.js 24 TypeScript Runner, isolated execution-worker, and Rust security/contributor boundaries.
- SQLite is the authoritative single writer with migration checksums, idempotency receipts, append-only DomainEvents and an atomic Outbox.
- Authentication/authorization uses audited Argon2 libraries, Bearer/session boundaries, owner/team/workspace visibility, and redacted RFC 9457 problems.
- pi remains an adapter over the real session port. Startup/subscribe/bind/sequential-tool ordering, exact session references, checkpoint alignment, and conservative crash recovery are mandatory.
- High-risk action digests bind canonical real arguments, environment, target, recipients, and base versions. Approval views never expose canonical secret arguments.

## Validated decisions

- Personal history can be created/run/steered/stopped/confirmed and restored with artifacts and exact checkpoints. Cold backups reject missing/corrupt objects and newer schemas.
- Shared workspaces enforce current operator, immutable context versions, selected sharing, team/workspace roles, immediate revocation, and single active Run.
- High-risk side effects require a single-use Permit. Stop persists queue snapshots before clearQueue/abort; unknown outcomes never replay.
- Handoffs use isolated read-only preparation, recipient-filtered sources/citations, fresh revision acceptance, and atomic takeover.
- Conclusions/source versions are immutable and linked to impact/review history. Archives are independently readable and preserve missing/unknown states.
- Beta is default-off and staged: B0 read-only snapshots, then fixed tools, Patch, and dual-approved cross-domain Artifacts. Every right only narrows.

## Evidence integrity decisions

- Faux models and synthetic canaries replace real providers and secrets. Integration and live API tests use temporary data directories.
- Test-support harnesses only seed and invoke the same production services used by Runner HTTP routes; no duplicate fake business state machines.
- GUI E2E files are test definitions, not execution evidence. Docker runtime bypass and unexecuted GUI cases remain explicitly open.
- Detailed deviations and follow-ups are maintained in `docs/architecture/deviations.md`.
