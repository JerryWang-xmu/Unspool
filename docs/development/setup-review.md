# Setup and Design-Origin Review Evidence

**Purpose**: Define the evidence required before accepting scaffold work. This review is predefined before those changes as required by the constitution.

## Bootstrap Evidence

- `tests/setup/bootstrap.test.ts` fails before the scaffold exists and passes afterward.
- Node.js 24 LTS and TypeScript 7.0 are pinned with exact dependency versions.
- npm and Cargo workspaces build without requiring Team, RecipientRules, ResourceBudget, or contributor-node for US1.
- `.gitignore` and `.dockerignore` cover dependencies, build output, local secrets, logs, and validation artifacts.
- No lifecycle script runs without an explicit reviewed allowlist entry.

## Design-Origin Evidence

- UI hierarchy, components, visual tokens, icons, and copy are original to Unspool.
- PI-Desktop is used only for abstract interaction research; no source, style, asset, screenshot, animation, brand element, or recognizable visual composition is reused.
- `THIRD_PARTY.md` records every direct dependency and design asset at introduction time.
- `SBOM.md` records generated dependency and container inventory requirements.
- `docs/design/provenance.md` records references, differences, and original-design decisions.

## Acceptance

Reviewers must mark each item with evidence links and a date. Unverified items are `BLOCKED`, not `PASS`.
