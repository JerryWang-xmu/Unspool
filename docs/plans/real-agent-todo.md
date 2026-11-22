# Real Agent implementation status and TODO

Status date: 2026-11-22. This file is the authoritative remaining-work list for the real Pi/OpenAI-compatible execution track. `[DONE]` requires executable evidence; `[TODO]` is not implemented or not yet proven.

## Evidence-backed completed work

- [DONE] Added provider configuration for `faux`, `openai-compatible`, and `opencode-go`, including model/API validation and the official OpenCode Go base URL: `https://opencode.ai/inference/go/openai/v1`.
- [DONE] Added secret-free Pi `models.json` generation and per-conversation `User-Agent` and `x-opencode-session` headers. API keys are read only from `file:` references.
- [DONE] Added real provider/model discovery to personal workspaces and Runner model profiles while retaining faux defaults.
- [DONE] Added real `createAgentSession` execution in an isolated worker with exact per-conversation session paths and no `continueRecent()`.
- [DONE] Added Runner ↔ worker IPC for start, steer, follow-up, stop, and close commands. SQLite writes remain owned by Runner API.
- [DONE] Persisted assistant text, technical completion, run attempts, and durable `session_checkpoint` records. Fixed the checkpoint foreign-key path and IPC close acknowledgement race.
- [DONE] `tests/integration/us1/openai-runtime.test.ts`: **3/3 PASS**.
- [DONE] `tests/integration/us1/agent-session.test.ts`: **1/1 PASS** against a local OpenAI-compatible SSE server, including Bearer, model ID, Go session header, User-Agent, and final text.
- [DONE] `tests/integration/us1/agent-executor.test.ts`: **1/1 PASS** through Runner HTTP API, real worker process, SQLite, model text, technical completion, and model discovery.

## P0 — required for the requested basic Agent

- [TODO] **Enable real providers in Windows startup.** `scripts/start-runner.ps1` still forces `UNSPOOL_MODEL_PROVIDER=faux`. Add a per-user configuration command and load provider/base URL/model/secret ref without printing or committing the key.
- [TODO] **Implement basic read/list/search tools.** Replace the current `noTools: "all"` worker startup with rooted read-only tools and prove path traversal and secret-file access are denied.
- [TODO] **Implement approved write/edit tools and Artifacts.** Connect tool proposals to the existing approval store, approval GUI, single-use Permit, and `ArtifactService`. Verify rejection, changed action, replay, and downloadable bytes. Arbitrary shell remains disabled.
- [TODO] **Verify real multi-turn behavior.** Exercise native steer and follow-up during active model execution, preserve their distinct queue semantics, and reconcile `queued_instruction` without duplicate prompts.
- [TODO] **Verify stop.** Abort a live model turn and settle `cancelled` without a later completion or failure overwriting the terminal state.
- [TODO] **Implement recovery/rehydration.** After worker or Runner restart, reopen only the exact session path. Do not auto-replay model or tool side effects. Currently a live session exists only inside the original worker process.
- [TODO] **Add GUI end-to-end coverage.** Drive task creation, model text, second turn, approval, Artifact, stop, and recovery through the real desktop client, not only service/API tests.
- [TODO] **Run the complete regression set.** US1, US2, UAT-28, desktop resilience, unit/integration tests, Node 24 release checks, secret scan, and Windows native smoke.

## P1 — provider compatibility and hardening

- [TODO] **Verify `openai-responses`.** Configuration accepts it, but current executable evidence covers only `openai-completions`.
- [TODO] **Add incremental assistant rendering.** Current Runner emits `message.completed`; token/chunk snapshots are not yet projected into a clean incremental GUI message stream.
- [TODO] **Add provider failure acceptance.** Cover 401/403, 429, timeout, malformed SSE, network loss, and provider errors without credential leakage or a stuck `running` Run.
- [TODO] **Add live OpenCode Go smoke test.** Real Go is **NOT RUN**. It requires a user-supplied Console key, selected model, explicit opt-in, and separate cost/security approval. Local SSE evidence must not be represented as cloud success.
- [TODO] **Document operator setup.** Add OpenAI-compatible and OpenCode Go configuration, model selection, `x-opencode-session`, User-Agent, endpoint examples, costs, and secret rotation instructions.
- [TODO] **Reconcile remaining implementation deviations.** Review queue release, attempt fencing, model-error precedence, worker close, API shutdown, and malformed worker events against `docs/plans/2026-11-22-real-pi-openai-agent.md`.

## Explicit non-goals for the current increment

- Arbitrary shell execution.
- Claiming paid cloud access or successful OpenCode Go calls without a real opt-in test.
- Treating a persisted `run.started` record as proof of model inference.
- Treating the current `noTools: "all"` worker as completion of the requested basic tool set.
