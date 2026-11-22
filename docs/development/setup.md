# Development Setup

## Supported baseline

- Ubuntu 24.04 LTS x86_64 for Runner and contributor-node development
- Windows 11 x64 or macOS 14+ Apple Silicon for desktop development
- Node.js 24 Maintenance LTS and npm 11+
- Rust stable pinned by `rust-toolchain.toml`
- Docker Engine 27+ with Compose v2 for validation

Node.js 26 is supported only for local bootstrap checks; CI and release validation use Node.js 24.
Do not treat a different host as a verified contributor-node platform.

## Install

```bash
npm ci --ignore-scripts
```

Use the committed `package-lock.json`. Direct dependencies are pinned exactly. Lifecycle scripts
remain disabled during ordinary installation; reviewed native packaging steps must be invoked
separately when an application bundle is required.

## Verify

```bash
node --test tests/setup/bootstrap.test.ts
npm run check
npm run test:setup
npm run test:unit
npm run test:contracts
npm run test:integration
npm run validate:compose
```

`npm run check` runs Biome, TypeScript, and Rust checks. `validate:compose` validates the Docker
topology without starting services or contacting a real model provider.

## Desktop

```bash
npm run dev:desktop
```

The desktop shell uses isolated Tauri commands. The renderer must not receive Runner session
secrets, direct database access, arbitrary file-read commands, arbitrary URL fetch, or arbitrary
Shell execution.

## Validation Runner

```bash
cp deploy/docker/env.example .env.validation
# Set UNSPOOL_BOOTSTRAP_CODE to a single-use test-only value.
docker compose --env-file .env.validation -f deploy/docker/compose.yml \
  --profile validation up -d runner-api model-gateway \
  execution-worker-1 execution-worker-2 fake-external fake-model
```

Default validation uses `UNSPOOL_MODEL_PROVIDER=faux`. No real model credential, paid API,
production file, or user session is required or permitted.

## Clean up

Use only `npm run validate:clean -- --profile validation` after the cleanup command exists. It must
remove only dedicated test containers, test data, and test keys. Do not run cleanup against a real
Runner data directory. See `quickstart.md` and `uat-catalog.md` for per-ID validation.
