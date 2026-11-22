# Independent post-remediation review — 2026-11-22

## Disposition

The independent reviewer who reported the three remaining HIGH findings re-inspected the changed source and test oracles. **All three findings are CLOSED at source level. No residual HIGH remains in those findings.** No CRITICAL finding was reported.

This is a focused source review, not production security certification.

## Closed findings and executable evidence

1. **Same-gate authorization sharing**
   - Removed the `inFlight` map and shared `authorizeOne` Promise path. Every call independently validates and consumes a Permit.
   - `tests/integration/us3/sqlite-permit-single-use.test.ts` adds same-gate concurrent identical calls and mismatched attempt/policy calls. The primary session ran this suite: **6/6 PASS**, including invalidation interleaving.

2. **Invalidation versus Permit consumption**
   - `consumeExecutionPermitAtomic` joins the current decision, request, and proposal in the same write transaction and requires approved state plus matching action digest, attempt, and policy before consuming.
   - The deterministic interleaving test invalidates immediately before consumption and observes zero tool invocations and `consumed_at = NULL`.

3. **Central snapshot reads without Ticket/budget enforcement**
   - Central GET requires `X-Unspool-Operation-Ticket`, derives body/action digests from the exact snapshot and entry, binds the authenticated recipient, and consumes Ticket/Grant usage before `readCentral`.
   - `tests/integration/us6/federation-route-security.test.ts` passed **2/2** in the primary session, including no-ticket denial, positive read, replay denial, distinct-ticket exhaustion, and revocation denial.

## Limits retained by the reviewer

- The reviewer inspected tests but did not execute them; the execution evidence belongs to the primary-session commands and logs.
- The revocation check reuses an already consumed/exhausted Grant, so it is not a standalone revocation-only oracle. The route's fresh Grant verification is present.
- Ticket signatures use a synthetic validation callback; production issuer signatures and live transport/mTLS remain unverified.
- Real Docker isolation, fixed-tool execution, Patch writes, and cross-host Artifact transfer remain outside this closure.

Earlier findings and residual GA limitations remain documented in the two initial review records. This focused closure does not convert the overall release-gate report into GA approval.
