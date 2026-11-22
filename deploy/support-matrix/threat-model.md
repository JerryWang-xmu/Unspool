# Threat model and support boundaries

## Assets

Owner credentials and sessions, private instructions/discussions/files/QA, canonical tool arguments, artifacts and hashes, operator/attempt epochs, Grants, data rights, execution Permits, and the SQLite/outbox/event history.

## Trust boundaries

1. **Desktop ↔ Runner**: bearer authentication, owner/member/workspace membership checks, and redacted RFC 9457 problems. No internal paths/stacks/canaries cross this boundary.
2. **Runner ↔ worker**: isolated process lifecycle, sequential tools, leases/epochs, clearQueue-before-abort, and execution-entered receipts. A model `tool_execution_start` is only preflight.
3. **Approval boundary**: canonical real payload is hashed; display arguments are complete but secret-free. A Permit binds action, attempt, and policy revision and is consumed once immediately before side effect. Unknown outcomes are not retried.
4. **Contributor nodes**: outbound mTLS only, no inbound listener, explicit snapshots and owner-signed Grants. Snapshot/path visibility, model/member/public/cache/offline rights are independent and only narrow.
5. **Fixed tools/Patch**: no shell, arbitrary argv/environment/network, or host path. Independent Grant, base preconditions, per-file journals, no auto-merge/writeback.
6. **Persistence/network**: one SQLite writer, atomic Outbox/inbox receipts, content digests, cold verified backups, and execution-network isolation. Model and control networks are separate from the internal execution network.

## Adversaries

Malicious model output, compromised worker/node, token thief, expired expert, stale operator, cross-tenant reader, symlink/TOCTOU attacker, malicious multipart/upload, tampered backup/object, slow client, and crash-after-side-effect.

## Residual limits

Docker runtime bypass was not executed in this environment and remains an open validation item. GUI E2E fixtures are defined but not all executed. Rust models/policy boundaries supplement rather than replace TypeScript integration tests. Independent security review is required before any Federated GA consideration.
