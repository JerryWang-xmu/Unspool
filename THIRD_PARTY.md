# Third-Party Inventory

**Status**: Baseline for Phase 1 (2026-11-22)

Unspool source is licensed under the repository [MIT License](LICENSE). MIT does not grant
rights to third-party software, assets, documentation, models, or brands. This inventory records
each direct dependency and design asset when it is introduced. Transitive npm dependencies are
pinned in `package-lock.json`; transitive Rust dependencies are pinned in `Cargo.lock`.

## Runtime and toolchain

| Component | Version | License | Use |
|---|---|---|---|
| Node.js | 24 LTS (Maintenance) | MIT | Runner, workers, build and test runtime |
| npm | 11+ | Artistic-2.0 | Workspace and lockfile management |
| TypeScript | 7.0.2 | Apache-2.0 | TypeScript compilation and checking |
| Rust | stable, pinned by `rust-toolchain.toml` | MIT OR Apache-2.0 | Tauri host and security-core boundary |
| Docker Engine / Compose | 27+ / v2 | Apache-2.0 | Local validation topology |

## Direct npm dependencies

| Package | Version | License | Introduced for |
|---|---|---|---|
| `@earendil-works/pi-coding-agent` | 1.6.0 | MIT | Agent execution adapter boundary |
| `argon2` | 0.45.2 | MIT | Argon2id password hashing with RFC 9106 associated-data support |
| `@node-rs/argon2` | 2.2.2 | MIT | Synchronous Argon2id hashing and verification helpers |
| `react` | 19.3.1 | MIT | Desktop renderer |
| `react-dom` | 19.3.1 | MIT | Desktop renderer |
| `@tauri-apps/api` | 2.12.5 | MIT OR Apache-2.0 | Isolated renderer command boundary |
| `vite` | 8.3.8 | MIT | Renderer development and build |
| `@vitejs/plugin-react` | 6.3.0 | MIT | Renderer React transform |
| `fastify` | 5.12.8 | MIT | Runner API HTTP surface |
| `@fastify/type-provider-typebox` | 6.3.0 | MIT | Fastify schema/type integration |
| `@sinclair/typebox` | 0.34.52 | MIT | Runtime schemas and environment validation |
| `vitest` | 5.1.1 | MIT | Unit, contract, and integration test runner |
| `fast-check` | 4.10.3 | MIT | Property-based tests and deterministic clocks |
| `@playwright/test` | 1.65.1 | Apache-2.0 | End-to-end test runner |
| `@biomejs/biome` | 2.6.8 | MIT OR Apache-2.0 | Formatting and linting |
| `@tauri-apps/cli` | 2.12.6 | MIT OR Apache-2.0 | Tauri development and build commands |
| `@types/node` | 24.19.2 | MIT | Node.js type declarations |
| `@types/react` | 19.3.0 | MIT | React type declarations |
| `@types/react-dom` | 19.3.0 | MIT | React DOM type declarations |

## Direct Rust dependencies

| Crate | Version | License | Use |
|---|---|---|---|
| `tauri` | 2.12.7 | MIT OR Apache-2.0 | Desktop host |
| `tauri-build` | 2.7.6 | MIT OR Apache-2.0 | Desktop build integration |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | Command response serialization |

## Container base images

| Image | License note | Use |
|---|---|---|
| `node:24-bookworm-slim` | Node.js MIT; Debian package licenses vary | Runner API build/runtime |
| `node:24-alpine` | Node.js MIT; Alpine package licenses vary | Validation health stubs |

Container image inventories, including operating-system packages, must be generated with the SBOM
process in [SBOM.md](SBOM.md) before any release.

## Design assets and references

| Asset or reference | Rights | Boundary |
|---|---|---|
| PI-Desktop repository in `references/PI-Desktop/` | LGPL-3.0 | Abstract interaction research only. No source, style token, asset, icon, screenshot, animation, brand element, or recognizable composition is copied into Unspool. See [design provenance](docs/design/provenance.md). |
| Unspool renderer shell and Windows icon | Original to Unspool | Uses system font stacks. The `U` bitmap icon in `apps/desktop/src-tauri/icons/` was generated programmatically for this project; no third-party image asset. |
| Unspool name and marks | Project brand | The MIT license does not grant trademark rights. |

## Maintenance rules

- Add or upgrade a direct dependency only together with this table and the appropriate lockfile.
- Prefer MIT-compatible licenses. GPL, AGPL, and LGPL code or assets require explicit compliance
  review before introduction; PI-Desktop remains a reference-only boundary.
- Regenerate and inspect the SBOM as part of release validation.
- Remove an asset from the product and this inventory if its origin or rights cannot be evidenced.
