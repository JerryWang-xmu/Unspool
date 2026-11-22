# Installation and startup

## Supported baseline

- Node.js 24 LTS (`>=24 <25`) and npm 11 or newer.
- Rust stable with `cargo fmt` and `cargo clippy` installed.
- A local data directory owned by the desktop user. The Runner and execution-worker never share write access to another application's database.
- No Team, cloud account, real model credential, or paid API is required for the personal faux workflow.

## Install and verify

```sh
npm ci
npm run check:types
npm run test:setup
npm run test:unit
npm run build
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
```

## Start the local Runner

Use a validation token and an empty data directory. Production requires an explicit owner token or session-store bootstrap; never embed a real secret in source control.

```sh
export UNSPOOL_DATA_DIR=/var/lib/unspool
export UNSPOOL_OWNER_TOKEN=<local-validation-token>
npm run start --workspace @unspool/runner-api
```

The API listens under `/v1` by default on `127.0.0.1:8080`. Health discovery is at `/healthz` and `/v1/health`. Federation starts as `disabled`; do not enable it until the selected Beta level and owner policy are understood.

## Filesystem permissions

The data directory, database, sessions, artifacts, and backups must be writable only by the Runner account. Do not place them on a shared drive or synchronize the live SQLite file while the Runner is active. Use cold backup instead.
