# Security incident response

1. **Contain**: emergency-disable federation, pause/revoke/quarantine the affected node, stop active Runs, and preserve queue snapshots. Do not replay unknown side effects.
2. **Preserve evidence**: take a verified cold backup and record file/object/receipt digests, Grant/policy revisions, operator/attempt epochs, and network/test results. Redact secrets and private content.
3. **Assess**: check Permit consumption, execution-entered/final receipts, contradictory receipts, access revocations, and whether any payload crossed the intended boundary. Mark uncertain outcomes `outcome_unknown`/`needs_confirmation`.
4. **Eradicate**: rotate owner/node credentials and sessions, invalidate affected Grants/Permits, and remove unconfirmed cached copies. Do not rewrite append-only history.
5. **Recover**: restore into an empty host, reconcile checkpoints and receipt gaps, review untrusted outputs as evidence, and require fresh independent approvals for high-risk actions.
6. **Learn**: document root cause, impacted scope, validation gaps, and regression tests in `docs/security/reviews/`. GA is blocked until every relevant gate has real evidence, including the worker network bypass when Docker is available.
