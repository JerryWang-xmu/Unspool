# Independent threat-model review — 2026-11-22

## Method and independence

A fresh read-only reviewer session inspected the threat model and the implementation without editing files. It was not the session that authored the implementation. This was an independent agent review, not a certification by an external security company.

## Scope

- `deploy/support-matrix/threat-model.md`, `grant-data-flow.md`, and `revocation-isolation.md`
- Approval store and decision routes
- Federation Grant, OperationTicket, snapshot, fixed-tool, Patch, and Artifact-transfer paths
- Docker Compose validation profile
- Documented implementation deviations

## Original disposition

**NO-GO for Federated GA.** The review identified two CRITICAL and five HIGH findings. The most important were cross-principal federation authorization, fail-open unsigned Tickets, caller-selected snapshot roots, process-local replay/revocation state, synthetic B1 success exposed through real-looking routes, approval decision races, and a known default Compose credential.

## Remediation evidence reviewed by the primary session

- Federation is unavailable unless an explicit loopback validation profile is selected; all federation requests require a bearer principal and a non-disabled level.
- Node ownership, Grant decisions, resource roots, snapshot reads, template ownership, stored Patch proposals, and transfer approvals are bound to authenticated principals and server-held records.
- Ticket signature verification is mandatory; Grant signatures include all canonical security fields, validity is enforced, and request/nonce/execution uniqueness plus usage budgets are committed in SQLite.
- Snapshot creation uses server-configured resource roots, lexical and real-path containment, every-component symlink rejection, device/hardlink checks, and same-handle reads with replacement checks.
- Central HTTP reads require a verified `snapshot.read` Grant, matching resource/root digest, recipient/owner access, and both manifest and Grant central-cache permission.
- Approval decisions use a pending-only transaction, one decision per request, insert-only proposals, and persisted audit records. Real SQLite Permit gates have conditional consumption and a narrow `outcome_unknown` to final transition.
- Backup manifests authenticate SQLite size/digest and listed object/session entries. Restore copies only listed regular files and runs `PRAGMA integrity_check`.
- Compose no longer supplies a default owner token and publishes the Runner port on loopback.
- Pending-action inspection reads registered action state and returns `not_found` for unknown IDs rather than fabricating a safe pending result.

## Executable controls added after review

- `tests/integration/us6/federation-route-security.test.ts`: cross-principal denial and positive controls over real HTTP.
- `tests/integration/us6/ticket-persistence.test.ts`: replay rejection after store restart.
- `tests/integration/us6/snapshot-ancestors.test.ts`: ancestor symlink escape rejection.
- `tests/integration/us3/sqlite-permit-single-use.test.ts`: two gate instances, one tool invocation, unknown-outcome replay denial, and finalization freezing.
- `tests/integration/us1/approval-store-race.test.ts`: one terminal approval decision.
- `tests/integration/us1/backup-database-integrity.test.ts`: tampered primary backup rejection.
- `tests/integration/foundation/persistence.test.ts`: shared per-file writer queue across two connections.

## Residual limitations and open gates

- The validation HTTP B1 adapters do not execute a real fixed-tool process, write Patch bytes, or transfer Artifact payloads. Their responses explicitly mark `validationOnly` and zero real side effects/transfer.
- Pairing, manifests, transfer records, and some security projections remain process-local in the validation adapter. They are not production federation storage.
- Backup authenticity is a local trusted-directory boundary; the self-digest is not a signature against an attacker who can replace both manifest and payload.
- Docker runtime bypass, live two-owner transport/mTLS, and production fixed-tool isolation remain unexecuted.
- The host ran Node 26 during this remediation; Node 24 remains the required release runtime.
- A later independent re-review could not start because the reviewer provider reported a five-hour quota limit. No claim of independent closure is made here.

**Disposition:** review performed; GA remains blocked by the residual validation and independent-review gates. Do not convert this record into a security certification.
