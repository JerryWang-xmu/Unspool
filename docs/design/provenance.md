# Design provenance and PI-Desktop similarity review

Unspool's implementation is authored against its local specifications and threat model. No proprietary source, asset, credential, or vendor-branded resource is intentionally copied.

The Tauri 2 + React shell uses standard web/Tauri APIs and project-owned styles/components. A visual similarity review is limited to general desktop productivity patterns: workspace navigation, forms, timelines, approvals, artifacts, and settings. These are functional requirements, not copied visual assets.

Dependency identity is recorded in `SBOM.md`; attribution/license notes are in `THIRD_PARTY.md`. `scripts/check-release.mjs` rechecks build/type/lint, secret scanning, container configuration, required provenance documents, and the absence of unlicensed/redistributed assets before any release claim.
