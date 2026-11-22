# Accepted implementation deviations

| Area | Deviation | Why accepted temporarily | Required follow-up |
|---|---|---|---|
| Node runtime | Development also used Node 26 before the final runtime gate | A separate Node 24.22.3 LTS runtime was used for the final gate | Full check, release checks, unit/bootstrap, US3/US6, US4, and browser suites passed on Node 24; retain the pinned runtime |
| Evidence registry | Evidence domain projections still use an in-process registry, with authoritative workspace/run/artifact metadata hydrated from SQLite at access time | The same services drive HTTP and per-ID scenarios without duplicate business logic | Move conclusions, sources, reviews, exceptions, exports, and action projections to canonical SQLite repositories before multi-process production |
| Federation fixtures | B0/B1 use synthetic owners/nodes/canaries and deterministic services | Enables adversarial validation without real credentials or paid APIs | Run live two-owner GUI and transport validation |
| Worker network | Real Docker validation was executed after enabling the local daemon | The daemon initially lacked images and the Runner data directory lacked node ownership | Validation passed 5/5 with model/public-network denial and fake-external positive control; retain image build and network restrictions |
| GUI acceptance | Real Chrome and independent Runner processes executed personal, five-client, and complete UAT-28 workflows | Other story-specific GUI definitions remain test definitions only | Keep using actual executed GUI evidence; do not promote unexecuted fixtures into passes |
| Backup migrations | Schema is advanced in a single migration loader with checksums | Ensures fresh and restored databases share one canonical chain | Keep future migrations append-only and back up existing hosts before upgrade |
| Approval storage | Requests/decisions/proposals are persisted in SQLite; in-memory test stores remain for unit seams | Preserves real API behavior and restart recovery | Keep atomic Permit consumption and exception audit coverage under concurrency |

No deviation permits skipped tests, fabricated evidence, real secrets, or silent feature expansion.
