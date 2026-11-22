# Real Pi Agent with OpenAI-Compatible Providers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run real multi-turn Pi AgentSessions from Unspool with OpenAI-compatible providers, including OpenCode Go, basic read tools, approved writes, artifacts, and recoverable history.

**Architecture:** A separate execution-worker owns Pi sessions and tool side effects. Runner API supervises it over IPC and remains the only SQLite writer. Model auth comes from per-user secret references; OpenCode Go uses its official OpenAI-compatible base URL and per-conversation headers.

**Tech Stack:** Node.js 24, TypeScript, Pi Coding Agent SDK, Fastify, SQLite, React/Tauri, Vitest, Playwright.

Current evidence and remaining `[TODO]` items are tracked in `docs/plans/real-agent-todo.md`.

---

## Accepted design and rejected alternatives

- **Chosen:** Worker process + IPC. Preserves process isolation and single-writer SQLite while supporting native Pi steering queues.
- **Rejected:** In-process model execution in Runner API. Smaller diff, but model/provider failures would share the API process and violate the execution boundary.
- **Rejected:** One Pi CLI process per prompt. Does not preserve live sessions, native steering/follow-up queues, exact recovery, or stop semantics.

## Acceptance contract

1. `opencode-go` resolves to `https://opencode.ai/inference/go/openai/v1`; generic providers accept another valid HTTP(S) base URL.
2. Requests use the configured model and Bearer credential without logging or committing secrets. Go requests carry `x-opencode-session=<conversationId>` and `User-Agent: unspool/0.1.0`.
3. Start creates a real Pi session; model text and terminal state reach the existing GUI timeline.
4. Steer and follow-up use the same live Pi session and preserve native queue semantics.
5. Read/list/search tools stay inside the assigned workspace root. Write/edit actions require the existing approval + single-use Permit and produce retrievable Artifacts. Arbitrary shell remains disabled.
6. Stop aborts the live Pi session and settles cancelled. Worker/API restart never replays side effects; recovery uses only the exact session path.
7. Local OpenAI-compatible tests cover streaming text, tools, headers, auth failure, approval, multi-turn behavior, and recovery. Real paid OpenCode Go remains `NOT RUN` until the user supplies explicit credentials and asks for a live smoke test.

## Tasks

### Task 1: Provider and runtime configuration

**Files:**
- Create `packages/pi-adapter/src/openai-runtime.ts`
- Modify `apps/runner-api/src/config/environment.ts`
- Modify `apps/runner-api/src/personal/service.ts`
- Test `tests/integration/us1/openai-runtime.test.ts`

- Extend provider configuration to `faux`, `openai-compatible`, and `opencode-go`.
- Generate a secret-free Pi models configuration and per-conversation model headers.
- Validate URLs, model IDs, token limits, and secret references.
- Surface the real provider/model through Runner discovery and workspace snapshots.
- Verify Go defaults, generic overrides, missing credentials, and secret-free serialized config.

### Task 2: Real Pi session worker

**Files:**
- Create `apps/execution-worker/src/agent-session.ts`
- Create `apps/execution-worker/src/agent-process.ts`
- Test `tests/integration/us1/agent-session.test.ts`

- Implement create/open-exact session lifecycle with `ModelRuntime` and `SessionManager`.
- Invoke `createAgentSession` and the existing `createPiSessionAdapter`.
- Project model text, completion, failures, stop, and native steer/follow-up outcomes.
- Keep arbitrary shell disabled and require an explicit workspace root.
- Run protocol tests against a local OpenAI-compatible streaming server; assert Go headers and no credential disclosure.

### Task 3: Runner IPC and Run persistence

**Files:**
- Create `apps/runner-api/src/agent/executor.ts`
- Create `apps/runner-api/src/agent/ipc-executor.ts`
- Modify `apps/runner-api/src/runs/service.ts`
- Modify `apps/runner-api/src/index.ts`
- Modify `apps/runner-api/tsconfig.json`
- Test `tests/integration/us1/agent-executor.test.ts`

- Dispatch start/steer/follow-up/stop after the existing command commit.
- Add attempt records, worker events, terminal Run states, and unknown-outcome transitions.
- Keep Runner API as the only database writer.
- Preserve idempotent command behavior and existing run recovery tests.

### Task 4: Basic tools, approval, and Artifacts

**Files:**
- Create `apps/execution-worker/src/agent-tools.ts`
- Modify `apps/runner-api/src/agent/ipc-executor.ts`
- Test `tests/integration/us1/agent-tools.test.ts`

- Add rooted read/list/search tools.
- Route write/edit proposals through the existing approval store and single-use Permit.
- Save approved outputs through `ArtifactService` and verify bytes can be downloaded.
- Cover path traversal, rejection, changed action, duplicate consumption, and shell absence.

### Task 5: Windows configuration and operator docs

**Files:**
- Create `scripts/configure-openai.ps1`
- Modify `scripts/start-runner.ps1`
- Modify `docs/windows-local.md`
- Create `docs/guides/openai-compatible.md`

- Add an interactive local configuration script with an OpenCode Go preset.
- Store API keys only under `%LOCALAPPDATA%\Unspool\secrets` and pass secret references to Runner.
- Document model selection, generic endpoints, Go requirements, costs, and live-smoke opt-in.

### Task 6: End-to-end verification

**Files:**
- Create `scripts/validate-real-agent.mjs`
- Create `tests/e2e/us1/real-agent.spec.ts`
- Create `artifacts/validation/real-agent/summary.json` (generated, ignored)

- Exercise model text, second turn, follow-up, approved write, Artifact download, stop, and exact recovery through the actual GUI/Runner/Worker path.
- Rerun US1/US2/UAT-28, resilience tests, Node 24 `npm run check`, unit/integration tests, secret scan, and release checks.
- Record real cloud as `NOT RUN` unless the user explicitly supplies a credential and requests that separate smoke test.

No Git commit is created by this plan; the user must explicitly request any later commit or push.
