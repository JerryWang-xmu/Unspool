# Software Bill of Materials

**Status**: Process and baseline established for Phase 1 (2026-11-22). No release SBOM has been
generated yet; generated inventories are release-gate evidence, not substitutes for them.

## Scope

An Unspool release SBOM covers:

1. npm workspace packages and transitive dependencies from `package-lock.json`;
2. Rust workspace crates and transitive crates from `Cargo.lock`;
3. container base images and operating-system packages for every shipped OCI image;
4. bundled design assets, if any are introduced later.

## Authoritative inputs

- `package-lock.json` pins exact npm versions and integrity hashes.
- `Cargo.lock` pins exact Rust crate versions and checksums.
- `deploy/docker/Dockerfile` and `deploy/docker/compose.yml` define shipped images.
- [THIRD_PARTY.md](THIRD_PARTY.md) records direct dependency licenses and introduction reasons.
- [Design provenance](docs/design/provenance.md) records asset origin and reuse boundaries.

## Required generation

Before any release, generate machine-readable inventories in CycloneDX or SPDX form under
`artifacts/sbom/<version>/`:

```bash
npm sbom --sbom-format cyclonedx > artifacts/sbom/<version>/npm.cdx.json
cargo metadata --locked --format-version 1 > artifacts/sbom/<version>/cargo-metadata.json
```

The Rust inventory must be converted to a standard SBOM format with a reviewed generator. Each
shipped container image must be scanned from its final digest, not from a mutable tag. The release
evidence must record:

- the source commit, tool versions, and generation timestamp;
- image digests and base-image digests;
- direct and transitive component names, versions, and licenses;
- known vulnerabilities with severity, status, and disposition;
- the reviewer and the comparison against [THIRD_PARTY.md](THIRD_PARTY.md).

## Gates

- No release with an unreviewed GPL, AGPL, or LGPL component, asset, or code copy.
- No release with an unresolved critical or high-severity vulnerability without a recorded,
  time-bounded exception approved by the responsible reviewers.
- No release whose SBOM omits a shipped direct dependency or container base image.
- SBOM artifacts must not contain credentials, private keys, or user data.
