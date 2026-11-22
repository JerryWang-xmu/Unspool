# Grant and data-flow contract

1. An owner selects resources explicitly. No resource is public by default.
2. The node seals an immutable private snapshot. Only selected regular files are included; traversal, symlink, cross-mount, and unconfirmed hardlinks are rejected.
3. A Grant binds owner, resource digest, operations, recipients, rights, time window, usage/budget, cache policy, and policy revision. Owner signatures and local terminal states are authoritative.
4. An OperationTicket binds request, nonce, execution, Grant/action/recipient/body digests, and a short validity window. Requests/nonces/leases are single-use.
5. Reads occur only within rights and budgets. Derived labels intersect source, recipient, and requested rights; narrowing requires an owner review record.
6. Fixed tools run only a registered digest-bound schema with empty environment and disabled network. Patch requires an independent Grant and exact base digests.
7. Cross-domain Artifact transfer requires both source and recipient owner approval. Missing approval returns zero payload. Revoked/invalid/unavailable states remain visible with no payload.
8. Receipts are append-only and deduplicated. Backfill marks/resolves gaps; contradictory results require evidence review and never become verified business facts.

Local expiry, revocation, isolation, and budget exhaustion take precedence over remote claims and cached content.
