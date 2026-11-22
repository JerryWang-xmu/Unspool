---
description: "Task list for Unspool general-purpose Agent and federated collaboration"
---

# Tasks: Unspool 通用 Agent 与联邦式协作

**Input**: Design documents from `/specs/001-agent-federated-collaboration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, uat-catalog.md

**Tests**: Included. The specification contains acceptance scenarios and the constitution requires an observable failing check before implementation. Every story starts with contract/integration/E2E tests that must fail for the intended reason before its implementation begins.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Phase 1 and Phase 2 are mandatory shared prerequisites; story phases follow the specification priorities P1–P6.

## Format: `[ID] [P?] [Story] Description`

- Every task is an unchecked checklist item with a sequential ID and exact file path.
- `[P]` means the task uses different files and has no dependency on another incomplete task.
- `[US1]`–`[US6]` are used only in the corresponding user story phase.
- Every canonical entity field is cited explicitly from `data-model.md` in its implementing task; unresolved or additional constraints must be corrected before implementation.

## Path Conventions

- Desktop: `apps/desktop/`; Runner API: `apps/runner-api/`; execution: `apps/execution-worker/`; model gateway: `apps/model-gateway/`; contributor node: `apps/contributor-node/`.
- Shared TypeScript: `packages/contracts/`, `packages/domain/`, `packages/pi-adapter/`, `packages/persistence/`, `packages/security/`, `packages/rust-security-core/`, `packages/test-support/`.
- Deployment and validation: `deploy/`, `tests/`, `artifacts/validation/`.
- Canonical constraints are cited from `data-model.md`; tasks do not duplicate or weaken those rules.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize only the personal-MVP toolchains, security boundaries, validation harness, and compliance records. Team and federation infrastructure is intentionally deferred so it cannot block US1.

- [X] T001 Write failing clean-checkout/bootstrap smoke validation in `tests/setup/bootstrap.test.ts` before any scaffold or dependency changes.
- [X] T002 Predefine manual setup and design-origin review evidence in `docs/development/setup-review.md` before scaffold changes.
- [X] T003 Create the npm/Cargo workspace and planned directory skeleton in `package.json`, `Cargo.toml`, `apps/`, and `packages/`.
- [X] T004 Pin Node.js 24 LTS, TypeScript 7.0, and `@earendil-works/pi-coding-agent` 1.6.0 in `package.json`, `.nvmrc`, and `package-lock.json`.
- [X] T005 [P] Initialize the Tauri 2 + React desktop shell with isolated renderer commands in `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src/main.tsx`.
- [X] T006 [P] Initialize the Fastify + TypeBox Runner API skeleton in `apps/runner-api/package.json` and `apps/runner-api/src/index.ts`.
- [X] T007 [P] Configure Biome, TypeScript checks, Rust fmt/clippy, and repository formatting in `biome.json`, `tsconfig.base.json`, and `Cargo.toml`.
- [X] T008 [P] Configure Vitest, fast-check, Playwright, and deterministic test clocks in `vitest.config.ts`, `playwright.config.ts`, and `packages/test-support/src/clock.ts`.
- [X] T009 [P] Create the validation Docker Compose topology for Runner, two workers, model gateway, faux model, and fake external service in `deploy/docker/compose.yml` and `deploy/docker/env.example`.
- [X] T010 [P] Establish MIT, third-party inventory, SBOM, and design-provenance records in `LICENSE`, `THIRD_PARTY.md`, `SBOM.md`, and `docs/design/provenance.md`.
- [X] T011 [P] Add environment validation and secret-reference configuration without plaintext shared secrets in `apps/runner-api/src/config/environment.ts` and `deploy/docker/env.example`.
- [X] T012 [P] Add CI entry points for checks, unit, contract, integration, E2E, security, and release validation in `package.json` and `.github/workflows/validation.yml`.
- [X] T013 Verify clean-checkout setup and document the exact toolchain bootstrap in `docs/development/setup.md`.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Provide only the personal/shared execution primitives required before US1: canonical contracts, persistence, identity, default SecurityLabel, event reliability, worker lifecycle, and personal test fixtures. Team, RecipientRules/ResourceBudget, and contributor-node work are not prerequisites.

**⚠️ CRITICAL**: No user-story implementation may begin until this phase and its foundation tests pass. The first task writes and observes the expected failures before any foundational implementation.

- [X] T014 Write failing foundation persistence, auth/visibility, schema compatibility, idempotency, event replay, worker lifecycle, worker-isolation, and validation-catalog completeness tests in `tests/integration/foundation/` and `tests/contract/foundation/` before foundational implementation.
- [X] T015 Implement the per-ID UAT/TO/T validation-case registry and catalog-completeness checks in `packages/test-support/src/validation-cases.ts` and `tests/contract/validation-catalog.test.ts`, linked to `quickstart.md` and `uat-catalog.md`.
- [X] T016 Implement SQLite WAL, foreign keys, busy timeout, migration journal, and single-writer queue in `packages/persistence/src/database.ts` and `packages/persistence/src/migrations.ts`.
- [X] T017 Implement UUIDv7, RFC 3339 time, monotonic revisions, JCS canonicalization, SHA-256 digests, and Ed25519 test vectors in `packages/security/src/primitives.ts` and `packages/security/test/primitives.test.ts`.
- [X] T018 Implement Command envelopes, idempotency receipts, payload-digest conflict handling, and revision checks in `packages/domain/src/command.ts` and `packages/persistence/src/command-receipt.ts`.
- [X] T019 Implement RFC 9457 problem responses and the contract error-code mapping with redaction in `apps/runner-api/src/errors/problem.ts` and `apps/runner-api/test/errors.test.ts`.
- [X] T020 Implement bootstrap, invitations, Argon2id passwords, opaque sessions, and desktop keychain storage in `apps/runner-api/src/auth/service.ts` and `apps/desktop/src-tauri/src/credentials.rs`.
- [X] T021 Implement object-level authorization and reusable visibility filtering for queries, events, errors, downloads, and exports in `packages/domain/src/authorization.ts` and `apps/runner-api/src/middleware/visibility.ts`.
- [X] T022 Implement TypeBox-to-OpenAPI generation and runtime schema validation in `packages/contracts/src/generate.ts` and `apps/runner-api/src/middleware/schema.ts`.
- [X] T023 [P] Create the User model and migration in `packages/domain/src/user.ts` and `packages/persistence/schema/user.sql`; canonical fields per `data-model.md`: `User.id`, `User.displayName`, `User.status`, `User.authVersion`, `User.createdAt`, `User.disabledAt?`.
- [X] T024 [P] Create the Runner model and migration in `packages/domain/src/runner.ts` and `packages/persistence/schema/runner.sql`; canonical fields per `data-model.md`: `Runner.id`, `Runner.teamId?`, `Runner.name`, `Runner.purpose`, `Runner.status`, `Runner.version`, `Runner.capabilities`, `Runner.policyRevision`, `Runner.lastHeartbeatAt`.
- [X] T025 [P] Create the RunnerGrant model and migration in `packages/domain/src/runner-grant.ts` and `packages/persistence/schema/runner-grant.sql`; canonical fields per `data-model.md`: `RunnerGrant.runnerId`, `RunnerGrant.teamId?`, `RunnerGrant.subjectType`, `RunnerGrant.subjectId`, `RunnerGrant.allowedPolicy`.
- [X] T026 [P] Create the ModelProfile model and migration in `packages/domain/src/model-profile.ts` and `packages/persistence/schema/model-profile.sql`; canonical fields per `data-model.md`: `ModelProfile.id`, `ModelProfile.runnerId`, `ModelProfile.provider`, `ModelProfile.model`, `ModelProfile.reasoningOptions`, `ModelProfile.secretRef`, `ModelProfile.enabled`.
- [X] T027 [P] Create the Workspace model and migration in `packages/domain/src/workspace.ts` and `packages/persistence/schema/workspace.sql`; canonical fields per `data-model.md`: `Workspace.id`, `Workspace.kind`, `Workspace.teamId?`, `Workspace.ownerId`, `Workspace.runnerId`, `Workspace.name`, `Workspace.goal`, `Workspace.completionCriteria`, `Workspace.status`, `Workspace.visibility`, `Workspace.agentConfigSnapshot`, `Workspace.federationMode`, `Workspace.revision`, `Workspace.createdAt`, `Workspace.archivedAt?`.
- [X] T028 [P] Create the WorkspaceMember model and migration in `packages/domain/src/workspace-member.ts` and `packages/persistence/schema/workspace-member.sql`; canonical fields per `data-model.md`: `WorkspaceMember.workspaceId`, `WorkspaceMember.userId`, `WorkspaceMember.role`, `WorkspaceMember.canApprove`, `WorkspaceMember.canReview`, `WorkspaceMember.joinedAt`, `WorkspaceMember.leftAt?`.
- [X] T029 [P] Create the WorkspaceControl concurrency model and migration in `packages/domain/src/workspace-control.ts` and `packages/persistence/schema/workspace-control.sql`; canonical fields per `data-model.md`: `WorkspaceControl.workspaceId`, `WorkspaceControl.operatorId`, `WorkspaceControl.operatorEpoch`, `WorkspaceControl.activeRunId?`, `WorkspaceControl.activeRunEpoch`, `WorkspaceControl.revision`, `WorkspaceControl.updatedAt`.
- [X] T030 [P] Create the DomainEvent append-only model and migration in `packages/domain/src/domain-event.ts` and `packages/persistence/schema/domain-event.sql`; canonical fields per `data-model.md`: `DomainEvent.id`, `DomainEvent.workspaceId`, `DomainEvent.sequence`, `DomainEvent.schemaVersion`, `DomainEvent.type`, `DomainEvent.actorId?`, `DomainEvent.runId?`, `DomainEvent.occurredAt`, `DomainEvent.visibility`, `DomainEvent.payloadRef`, `DomainEvent.payloadDigest`.
- [X] T031 [P] Create the TransientOutput model and migration in `packages/domain/src/transient-output.ts` and `packages/persistence/schema/transient-output.sql`; canonical fields per `data-model.md`: `TransientOutput.runId`, `TransientOutput.offset`, `TransientOutput.delta`, `TransientOutput.createdAt`.
- [X] T032 [P] Create the OutboxMessage model and migration in `packages/domain/src/outbox-message.ts` and `packages/persistence/schema/outbox-message.sql`; canonical fields per `data-model.md`: `OutboxMessage.id`, `OutboxMessage.domainEventId`, `OutboxMessage.destination`, `OutboxMessage.state`, `OutboxMessage.attemptCount`, `OutboxMessage.availableAt`.
- [X] T033 [P] Create the InboxReceipt model and migration in `packages/domain/src/inbox-receipt.ts` and `packages/persistence/schema/inbox-receipt.sql`; canonical fields per `data-model.md`: `InboxReceipt.consumerId`, `InboxReceipt.messageId`, `InboxReceipt.receivedAt`, `InboxReceipt.resultDigest`.
- [X] T034 [P] Create the CommandReceipt model and migration in `packages/domain/src/command-receipt.ts` and `packages/persistence/schema/command-receipt.sql`; canonical fields per `data-model.md`: `CommandReceipt.actorId`, `CommandReceipt.workspaceId`, `CommandReceipt.commandId`, `CommandReceipt.payloadDigest`, `CommandReceipt.responseDigest`, `CommandReceipt.acceptedAt`, `CommandReceipt.response`.
- [X] T035 [P] Create the SchemaMigration model and migration in `packages/domain/src/schema-migration.ts` and `packages/persistence/schema/schema-migration.sql`; canonical fields per `data-model.md`: `SchemaMigration.version`, `SchemaMigration.checksum`, `SchemaMigration.appliedAt`, `SchemaMigration.backupManifestId`.
- [X] T036 [P] Implement only the Attribution shared value object in `packages/contracts/src/attribution.ts`; cite `data-model.md` §1 fields `Attribution.actorId`, `Attribution.displayNameAtTime`, `Attribution.rolesAtTime`, and `Attribution.occurredAt`.
- [X] T037 [P] Create the shared SecurityLabel contract and Stable default-label generator with built-in personal/workspace scopes and no Beta RecipientRules dependency in `packages/contracts/src/security-label.ts` and `packages/security/src/default-label.ts`; canonical fields per `data-model.md`: `SecurityLabel.id`, `SecurityLabel.version`, `SecurityLabel.purposeRules`, `SecurityLabel.memberRules`, `SecurityLabel.modelRecipientRules`, `SecurityLabel.targetDomainRules`, `SecurityLabel.publicVisibility`, `SecurityLabel.cacheAndRetention`, `SecurityLabel.untrustedContent`, `SecurityLabel.reviewHistory[]`.
- [X] T038 Implement transactional domain-state + audit + idempotent response + Outbox commits in `packages/persistence/src/unit-of-work.ts` and `packages/persistence/test/unit-of-work.test.ts`.
- [X] T039 Implement ordered DomainEvent projection, keyset pagination, SSE replay, heartbeat, and permission-aware reconnect in `apps/runner-api/src/events/service.ts` and `apps/runner-api/src/events/sse.ts`.
- [X] T040 Implement content-addressed immutable object storage, fsync/rename ingestion, manifests, and orphan reconciliation in `packages/persistence/src/object-store.ts` and `packages/persistence/test/object-store.test.ts`.
- [X] T041 Implement fixed-pool worker assignment, attempt leases, per-worker workspaces, and no-DockerSocket deployment in `apps/runner-api/src/workers/scheduler.ts` and `deploy/docker/compose.yml`.
- [X] T042 Implement the execution-worker main runtime with assignment intake, lease heartbeat, session-package loading, event batch upload, shutdown, and reconciliation in `apps/execution-worker/src/main.ts` and `apps/execution-worker/src/lifecycle.ts`.
- [X] T043 Implement the pi workspace session registry with explicit session paths, sequential tools, disabled prompt expansion, extension-error gating, and subscribe/bind/prompt order in `packages/pi-adapter/src/session-registry.ts`.
- [X] T044 Implement the model gateway boundary, per-attempt model tickets, faux provider, egress filtering, and sanitized usage reporting in `apps/model-gateway/src/service.ts` and `apps/model-gateway/src/providers/faux.ts`.
- [X] T045 Implement Runner health, version, capability, schema, and `maxUploadBytes` discovery in `apps/runner-api/src/routes/health.ts` and `apps/runner-api/src/capabilities.ts`.
- [X] T046 Implement redacted operational logging and separate metadata-only analytics storage in `apps/runner-api/src/telemetry/logging.ts` and `apps/runner-api/src/telemetry/analytics-store.ts`.
- [X] T047 Build faux provider, spy tools, canary files, external-side-effect, and controlled-clock fixtures without contributor-node or malicious-node dependencies in `packages/test-support/src/index.ts` and `packages/test-support/fixtures/`.

**Checkpoint**: Personal foundation is ready without Team, RecipientRules, ResourceBudget, or contributor-node dependencies; canonical models, identity, default labels, persistence, execution workers, reliability fixtures, and the per-ID validation registry are validated.

## Phase 3: User Story 1 - 个人独立完成真实 Agent 工作 (Priority: P1) 🎯 MVP

**Goal**: A new user completes a real personal Agent task with tools and artifacts, without team configuration, and resumes it after GUI and Runner restarts.

**Independent Test**: On a clean supported Runner, use only one user and the GUI to complete a tool-bearing personal task, save artifacts, restart both GUI and Runner, and continue the same history. This maps to spec US1 and quickstart QS-01.

### Tests for User Story 1

- [X] T048 [P] [US1] Write failing personal-task and run API contract tests in `tests/contract/us1/personal-runs.test.ts` using `contracts/runner-api.openapi.yaml`.
- [X] T049 [P] [US1] Write failing pi session, sequential execution, clearQueue/abort, and recovery contract tests in `tests/contract/us1/pi-adapter.test.ts`.
- [X] T050 [P] [US1] Write failing personal history, artifact, and cold-backup integration tests in `tests/integration/us1/persistence-recovery.test.ts`.
- [X] T051 [P] [US1] Write failing approval-before-side-effect and single-user exception and secret-canary redaction tests in `tests/integration/us1/approval-baseline.test.ts`.
- [X] T052 [P] [US1] Write failing GUI-only personal creation, GUI approve-once/reject-once with file-hash and Permit audit assertions, tool, artifact, restart, and resume E2E tests in `tests/e2e/us1/personal-task.spec.ts`.

### Implementation for User Story 1

- [X] T053 [P] [US1] Create the AgentConversation model and migration in `packages/domain/src/agent-conversation.ts` and `packages/persistence/schema/agent-conversation.sql`; canonical fields per `data-model.md`: `AgentConversation.id`, `AgentConversation.workspaceId`, `AgentConversation.piSessionRef`, `AgentConversation.sessionFormatVersion`, `AgentConversation.continuationOfId?`, `AgentConversation.createdAt`.
- [X] T054 [P] [US1] Create the SessionCheckpoint model and migration in `packages/domain/src/session-checkpoint.ts` and `packages/persistence/schema/session-checkpoint.sql`; canonical fields per `data-model.md`: `SessionCheckpoint.id`, `SessionCheckpoint.conversationId`, `SessionCheckpoint.runId?`, `SessionCheckpoint.piLeafId`, `SessionCheckpoint.lastPersistedEntryId`, `SessionCheckpoint.lastProjectedEventId`, `SessionCheckpoint.createdAt`.
- [X] T055 [P] [US1] Create the Run model and migration in `packages/domain/src/run.ts` and `packages/persistence/schema/run.sql`; canonical fields per `data-model.md`: `Run.id`, `Run.workspaceId`, `Run.conversationId`, `Run.sequence`, `Run.state`, `Run.operatorEpoch`, `Run.runnerId`, `Run.contextSnapshotId`, `Run.startedBy`, `Run.startedAt`, `Run.endedAt?`, `Run.lastKnownCheckpoint?`.
- [X] T056 [P] [US1] Create the RunAttempt model and migration in `packages/domain/src/run-attempt.ts` and `packages/persistence/schema/run-attempt.sql`; canonical fields per `data-model.md`: `RunAttempt.id`, `RunAttempt.runId`, `RunAttempt.workerId`, `RunAttempt.attemptEpoch`, `RunAttempt.state`, `RunAttempt.leaseExpiresAt`, `RunAttempt.startedAt`, `RunAttempt.settledAt?`, `RunAttempt.unknownReason?`.
- [X] T057 [P] [US1] Create the RunCommand model and migration in `packages/domain/src/run-command.ts` and `packages/persistence/schema/run-command.sql`; canonical fields per `data-model.md`: `RunCommand.id`, `RunCommand.runId?`, `RunCommand.workspaceId`, `RunCommand.kind`, `RunCommand.payload`, `RunCommand.payloadDigest`, `RunCommand.commandId`, `RunCommand.actorId`, `RunCommand.operatorEpoch`, `RunCommand.acceptedAt`, `RunCommand.resultRef?`.
- [X] T058 [P] [US1] Create the QueuedInstruction model and migration in `packages/domain/src/queued-instruction.ts` and `packages/persistence/schema/queued-instruction.sql`; canonical fields per `data-model.md`: `QueuedInstruction.id`, `QueuedInstruction.runId`, `QueuedInstruction.sourceCommandId`, `QueuedInstruction.kind`, `QueuedInstruction.body`, `QueuedInstruction.state`, `QueuedInstruction.position`, `QueuedInstruction.dequeuedAt?`, `QueuedInstruction.persistedAt?`.
- [X] T059 [P] [US1] Create the TaskContextSnapshot model and migration in `packages/domain/src/task-context-snapshot.ts` and `packages/persistence/schema/task-context-snapshot.sql`; canonical fields per `data-model.md`: `TaskContextSnapshot.id`, `TaskContextSnapshot.runId`, `TaskContextSnapshot.contextVersionIds[]`, `TaskContextSnapshot.renderedDigest`, `TaskContextSnapshot.createdAt`.
- [X] T060 [P] [US1] Create the UsageRecord model and migration in `packages/domain/src/usage-record.ts` and `packages/persistence/schema/usage-record.sql`; canonical fields per `data-model.md`: `UsageRecord.runId`, `UsageRecord.provider`, `UsageRecord.inputTokens?`, `UsageRecord.outputTokens?`, `UsageRecord.costAmount?`, `UsageRecord.costCurrency?`, `UsageRecord.reliability`.
- [X] T061 [P] [US1] Create the CompletionAssessment model and migration in `packages/domain/src/completion-assessment.ts` and `packages/persistence/schema/completion-assessment.sql`; canonical fields per `data-model.md`: `CompletionAssessment.runId`, `CompletionAssessment.result`, `CompletionAssessment.reason?`, `CompletionAssessment.assessedBy`, `CompletionAssessment.assessedAt`, `CompletionAssessment.evidenceExceptionId?`.
- [X] T062 [P] [US1] Create the InputItem model and migration in `packages/domain/src/input-item.ts` and `packages/persistence/schema/input-item.sql`; canonical fields per `data-model.md`: `InputItem.id`, `InputItem.workspaceId`, `InputItem.kind`, `InputItem.body`, `InputItem.authorId`, `InputItem.createdAt`, `InputItem.references[]`.
- [X] T063 [P] [US1] Create the ToolCallRecord model and migration in `packages/domain/src/tool-call-record.ts` and `packages/persistence/schema/tool-call-record.sql`; canonical fields per `data-model.md`: `ToolCallRecord.id`, `ToolCallRecord.runAttemptId`, `ToolCallRecord.toolCallId`, `ToolCallRecord.parentToolCallId?`, `ToolCallRecord.toolName`, `ToolCallRecord.originalArgsDigest`, `ToolCallRecord.effectiveArgsDigest`, `ToolCallRecord.state`, `ToolCallRecord.preflightAt`, `ToolCallRecord.executionEnteredAt?`, `ToolCallRecord.finalizedAt?`, `ToolCallRecord.resultDigest?`, `ToolCallRecord.transcriptEntryId?`.
- [X] T064 [P] [US1] Create the ActionProposal model and migration in `packages/domain/src/action-proposal.ts` and `packages/persistence/schema/action-proposal.sql`; canonical fields per `data-model.md`: `ActionProposal.id`, `ActionProposal.runId`, `ActionProposal.attemptId`, `ActionProposal.toolCallId`, `ActionProposal.toolName`, `ActionProposal.canonicalArgs`, `ActionProposal.displayArgs`, `ActionProposal.secretRefs[]`, `ActionProposal.actionDigest`, `ActionProposal.purpose`, `ActionProposal.impact`, `ActionProposal.risk`, `ActionProposal.baseResourceVersions[]`, `ActionProposal.createdAt`.
- [X] T065 [P] [US1] Create the ApprovalRequest model and migration in `packages/domain/src/approval-request.ts` and `packages/persistence/schema/approval-request.sql`; canonical fields per `data-model.md`: `ApprovalRequest.id`, `ApprovalRequest.actionProposalId`, `ApprovalRequest.requesterId`, `ApprovalRequest.requiredApproverPolicy`, `ApprovalRequest.state`, `ApprovalRequest.expiresAt`, `ApprovalRequest.policyRevision`, `ApprovalRequest.createdAt`.
- [X] T066 [P] [US1] Create the ApprovalDecision model and migration in `packages/domain/src/approval-decision.ts` and `packages/persistence/schema/approval-decision.sql`; canonical fields per `data-model.md`: `ApprovalDecision.id`, `ApprovalDecision.approvalRequestId`, `ApprovalDecision.decision`, `ApprovalDecision.decidedBy`, `ApprovalDecision.reason?`, `ApprovalDecision.decidedAt`, `ApprovalDecision.actionDigest`.
- [X] T067 [P] [US1] Create the ExecutionPermit model and migration in `packages/domain/src/execution-permit.ts` and `packages/persistence/schema/execution-permit.sql`; canonical fields per `data-model.md`: `ExecutionPermit.id`, `ExecutionPermit.approvalDecisionId`, `ExecutionPermit.actionDigest`, `ExecutionPermit.runAttemptId`, `ExecutionPermit.policyRevision`, `ExecutionPermit.expiresAt`, `ExecutionPermit.consumedAt?`, `ExecutionPermit.consumptionResult?`.
- [X] T068 [P] [US1] Create the BlobObject model and migration in `packages/domain/src/blob-object.ts` and `packages/persistence/schema/blob-object.sql`; canonical fields per `data-model.md`: `BlobObject.id`, `BlobObject.storageKey`, `BlobObject.sha256`, `BlobObject.size`, `BlobObject.mediaType`, `BlobObject.state`, `BlobObject.createdAt`.
- [X] T069 [P] [US1] Create the ArtifactVersion model and migration in `packages/domain/src/artifact-version.ts` and `packages/persistence/schema/artifact-version.sql`; canonical fields per `data-model.md`: `ArtifactVersion.id`, `ArtifactVersion.artifactId`, `ArtifactVersion.version`, `ArtifactVersion.blobId`, `ArtifactVersion.kind`, `ArtifactVersion.originType`, `ArtifactVersion.originId`, `ArtifactVersion.runId?`, `ArtifactVersion.attribution`, `ArtifactVersion.securityLabelId`, `ArtifactVersion.sourceSummary`.
- [X] T070 [P] [US1] Create the BackupManifest model and migration in `packages/domain/src/backup-manifest.ts` and `packages/persistence/schema/backup-manifest.sql`; canonical fields per `data-model.md`: `BackupManifest.id`, `BackupManifest.appVersion`, `BackupManifest.schemaVersion`, `BackupManifest.lastWorkspaceSequences`, `BackupManifest.objectEntries[]`, `BackupManifest.sessionEntries[]`, `BackupManifest.createdAt`, `BackupManifest.digest`.
- [X] T071 [US1] Implement personal workspace create/list/search/pin/archive/reopen behavior in `apps/runner-api/src/personal/service.ts` and `apps/runner-api/src/personal/repository.ts`.
- [X] T072 [US1] Implement run start, steer, follow-up, stop, queue actions, result confirmation, and concurrent-run uniqueness in `apps/runner-api/src/runs/service.ts`.
- [X] T073 [US1] Implement pi create/open/prompt/steer/followUp/clearQueue/abort and session checkpoint reconciliation in `packages/pi-adapter/src/session-adapter.ts` and `packages/pi-adapter/src/recovery.ts`.
- [X] T074 [US1] Implement policy-driven high-risk classification and canonical ActionProposal generation with complete semantic `displayArgs`, secret-only `secretRefs`, and real-payload digests in `packages/domain/src/risk-classifier.ts` and `packages/pi-adapter/src/action-proposal.ts`.
- [X] T075 [US1] Implement approval request/decision state transitions, independent-approver policy, explicit single-user exception, and complete audit records in `apps/runner-api/src/approvals/policy.ts` and `apps/runner-api/src/approvals/decisions.ts`.
- [X] T076 [US1] Implement deadline/cancellation handling, late-decision rejection, content/scope invalidation, and atomic single-use permit consumption in `apps/runner-api/src/approvals/permit-service.ts` and `packages/pi-adapter/src/approval-gate.ts`.
- [X] T077 [US1] Implement approval list/detail/decision endpoints with requester, action, impact, risk, policy fields, and secret-free `displayArgs`/`secretRefs` only in `apps/runner-api/src/routes/approvals.ts`.
- [X] T078 [US1] Implement desktop approval details, independent-decision controls, timeout states, and content-invalidated warnings in `apps/desktop/src/features/approvals/ApprovalCenter.tsx` and `apps/desktop/src/features/approvals/ApprovalDetails.tsx`.
- [X] T079 [US1] Implement artifact upload, version retrieval, preview, Range download, source metadata, and default 20MB policy in `apps/runner-api/src/artifacts/service.ts` and `apps/runner-api/src/artifacts/routes.ts`.
- [X] T080 [US1] Implement personal and run REST endpoints, including health-aware model selection and idempotent commands, in `apps/runner-api/src/routes/personal.ts` and `apps/runner-api/src/routes/runs.ts`.
- [X] T081 [US1] Implement cold backup, manifest generation, restore reconciliation, and upgrade-before-backup checks in `apps/runner-api/src/maintenance/backup.ts` and `apps/runner-api/src/maintenance/restore.ts`.
- [X] T082 [US1] Implement desktop task navigation, personal creation, model/Runner selection, and history recovery in `apps/desktop/src/features/personal/PersonalTaskList.tsx` and `apps/desktop/src/features/personal/PersonalTaskEditor.tsx`.
- [X] T083 [US1] Implement the desktop execution timeline, composer modes, tool/approval states, long-output handling, and stale-connection indicator in `apps/desktop/src/features/runs/RunTimeline.tsx` and `apps/desktop/src/features/runs/RunComposer.tsx`.
- [X] T084 [US1] Implement desktop artifacts, usage availability, backup status, and personal settings views in `apps/desktop/src/features/artifacts/ArtifactPanel.tsx` and `apps/desktop/src/features/settings/RunnerSettings.tsx`.
- [X] T085 [US1] Execute QS-01 and preserve GUI approval/rejection branches, file hashes, single-use Permit, personal recovery, and artifact evidence in `artifacts/validation/us1/` using `quickstart.md`.

**Checkpoint**: User Story 1 is a complete, independently usable MVP with no team or Beta dependency.

## Phase 4: User Story 2 - 将个人工作自然升级为团队共享现场 (Priority: P2)

**Goal**: Users selectively share prior work or create a shared workspace, collaborate through distinct input modes and versioned context, and maintain consistent state across multiple clients.

**Independent Test**: From a personal task containing private and shareable records, share only selected versions with a second member. Verify roles, discussions, suggestions, direct instructions, concurrent-start protection, and five-client consistency without exposing private content. Maps to spec US2 and quickstart QS-02.

### Tests for User Story 2

- [X] T086 [P] [US2] Write failing team, workspace, context, suggestion, and sharing API contract tests in `tests/contract/us2/collaboration.test.ts`.
- [X] T087 [P] [US2] Write failing selective-sharing and private-session separation integration tests in `tests/integration/us2/share-conversion.test.ts`.
- [X] T088 [P] [US2] Write failing context-version conflict, agent-exposure, and historical-snapshot tests in `tests/integration/us2/context-versions.test.ts`.
- [X] T089 [P] [US2] Write failing concurrent-start, cross-role access, expired-expert existing-session/history denial, and effective-collaboration metric tests in `tests/integration/us2/concurrency-and-metrics.test.ts`.
- [X] T090 [P] [US2] Write failing two-member and five-client GUI collaboration E2E tests in `tests/e2e/us2/shared-workspace.spec.ts`.

### Implementation for User Story 2

- [X] T091 [P] [US2] Create the Team model and migration in `packages/domain/src/team.ts` and `packages/persistence/schema/team.sql`; canonical fields per `data-model.md`: `Team.id`, `Team.name`, `Team.betaEnabled`, `Team.defaultPolicyRevision`, `Team.createdAt`.
- [X] T092 [P] [US2] Create the Membership model and migration in `packages/domain/src/membership.ts` and `packages/persistence/schema/membership.sql`; canonical fields per `data-model.md`: `Membership.id`, `Membership.teamId`, `Membership.userId`, `Membership.teamRoles[]`, `Membership.status`, `Membership.expiresAt?`.
- [X] T093 [P] [US2] Create the ContextItem model and migration in `packages/domain/src/context-item.ts` and `packages/persistence/schema/context-item.sql`; canonical fields per `data-model.md`: `ContextItem.id`, `ContextItem.workspaceId`, `ContextItem.kind`, `ContextItem.currentVersionId`, `ContextItem.createdBy`, `ContextItem.createdAt`, `ContextItem.removedAt?`.
- [X] T094 [P] [US2] Create the ContextVersion model and migration in `packages/domain/src/context-version.ts` and `packages/persistence/schema/context-version.sql`; canonical fields per `data-model.md`: `ContextVersion.id`, `ContextVersion.contextItemId`, `ContextVersion.version`, `ContextVersion.title`, `ContextVersion.body`, `ContextVersion.sourceRefs[]`, `ContextVersion.memberVisibility`, `ContextVersion.agentExposure`, `ContextVersion.attribution`, `ContextVersion.supersedesId?`.
- [X] T095 [P] [US2] Create the SuggestionDecision model and migration in `packages/domain/src/suggestion-decision.ts` and `packages/persistence/schema/suggestion-decision.sql`; canonical fields per `data-model.md`: `SuggestionDecision.suggestionId`, `SuggestionDecision.status`, `SuggestionDecision.decidedBy`, `SuggestionDecision.editedBody?`, `SuggestionDecision.resultingInputId?`, `SuggestionDecision.decidedAt`.
- [X] T096 [P] [US2] Create the SharePreview model and migration in `packages/domain/src/share-preview.ts` and `packages/persistence/schema/share-preview.sql`; canonical fields per `data-model.md`: `SharePreview.id`, `SharePreview.sourceWorkspaceId`, `SharePreview.selectedRecordIds[]`, `SharePreview.excludedCategories[]`, `SharePreview.createdBy`, `SharePreview.expiresAt`.
- [X] T097 [P] [US2] Create the ShareConversion model and migration in `packages/domain/src/share-conversion.ts` and `packages/persistence/schema/share-conversion.sql`; canonical fields per `data-model.md`: `ShareConversion.id`, `ShareConversion.sourceWorkspaceId`, `ShareConversion.targetWorkspaceId`, `ShareConversion.selectedRecordIds[]`, `ShareConversion.sourceRunStoppedAt`, `ShareConversion.createdBy`, `ShareConversion.createdAt`.
- [X] T098 [P] [US2] Create the AnalyticsEvent model and migration in `packages/domain/src/analytics-event.ts` and `packages/persistence/schema/analytics-event.sql`; canonical fields per `data-model.md`: `AnalyticsEvent.eventName`, `AnalyticsEvent.occurredAt`, `AnalyticsEvent.actorPseudonym?`, `AnalyticsEvent.workspacePseudonym?`, `AnalyticsEvent.metadata`.
- [X] T099 [P] [US2] Create the CollaborationMetric model and migration in `packages/domain/src/collaboration-metric.ts` and `packages/persistence/schema/collaboration-metric.sql`; canonical fields per `data-model.md`: `CollaborationMetric.week`, `CollaborationMetric.metricName`, `CollaborationMetric.subjectId`, `CollaborationMetric.value`, `CollaborationMetric.calculationVersion`.
- [X] T100 [US2] Implement team creation, membership invitation/deactivation/expiry, immediate existing-session and historical-workspace revocation for disabled/expired experts, and administrator boundaries while preserving attribution in `apps/runner-api/src/teams/service.ts` and `apps/runner-api/src/teams/routes.ts`.
- [X] T101 [US2] Implement Runner registration, authorization scopes, operational status, and model-profile management in `apps/runner-api/src/runners/service.ts` and `apps/runner-api/src/runners/routes.ts`.
- [X] T102 [US2] Implement shared-workspace draft/activation/configuration/archive and role permissions in `apps/runner-api/src/workspaces/service.ts` and `apps/runner-api/src/workspaces/routes.ts`.
- [X] T103 [US2] Implement immutable context versions, edit conflicts, member visibility, operator-approved Agent exposure, and run snapshots in `apps/runner-api/src/context/service.ts`.
- [X] T104 [US2] Implement discussions, suggestions, edited adoption, direct-instruction separation, and dual attribution in `apps/runner-api/src/collaboration/input-service.ts`.
- [X] T105 [US2] Implement share preview, selected-record copying, private original retention, and shared continuation-session creation in `apps/runner-api/src/sharing/service.ts` and `packages/pi-adapter/src/continuation.ts`.
- [X] T106 [US2] Implement Stable north-star and activation/share/suggestion metrics without message-body collection in `apps/runner-api/src/telemetry/collaboration-metrics.ts`.
- [X] T107 [US2] Implement team, workspace, member, context, discussion, suggestion, share, and export API endpoints in `apps/runner-api/src/routes/collaboration.ts`.
- [X] T108 [US2] Implement the desktop workspace overview, goal/criteria, current operator, blockers, and latest artifacts in `apps/desktop/src/features/workspaces/WorkspaceOverview.tsx`.
- [X] T109 [US2] Implement desktop context management, version conflicts, and explicit Agent-exposure state in `apps/desktop/src/features/context/ContextEditor.tsx`.
- [X] T110 [US2] Implement desktop member roles, online/operator separation, and approval/review permissions in `apps/desktop/src/features/members/MemberPanel.tsx`.
- [X] T111 [US2] Implement desktop discussion/suggestion/direct-instruction modes with independent drafts and consequence explanations in `apps/desktop/src/features/collaboration/ModeComposer.tsx`.
- [X] T112 [US2] Implement selective-share preview, excluded-private-content explanation, and persistent shared-state indicator in `apps/desktop/src/features/sharing/SharePreview.tsx` and `apps/desktop/src/features/sharing/SharedBadge.tsx`.
- [X] T113 [US2] Implement multi-client event synchronization, unread changes, filters, and offline recovery in `apps/desktop/src/features/timeline/TimelineSynchronizer.ts` and `apps/desktop/src/features/timeline/TimelineFilters.tsx`.
- [X] T114 [US2] Execute QS-02 and preserve sharing, role, concurrency, and five-client evidence in `artifacts/validation/us2/` using `quickstart.md`.

**Checkpoint**: User Stories 1 and 2 both work independently; selective sharing never exposes unselected private history.

## Phase 5: User Story 3 - 在副作用发生前保持任务安全可控 (Priority: P3)

**Goal**: Operators control run execution while independent approvers authorize high-risk actions before side effects; failures and unknown outcomes remain honest and recoverable.

**Independent Test**: Exercise approve, reject, timeout, content mutation, self-approval, stop-with-queue, lost-response retry, and worker crashes against real canary files and a counting external endpoint. Maps to spec US3 and quickstart QS-03.

### Tests for User Story 3

- [X] T115 [P] [US3] Write failing approval decision, action-digest, expiry, and single-use-permit contract tests in `tests/contract/us3/approvals.test.ts`.
- [X] T116 [P] [US3] Write failing zero-side-effect, content-change, self-approval, and late-approval integration tests in `tests/integration/us3/approval-boundary.test.ts`.
- [X] T117 [P] [US3] Write failing lost-response idempotency and concurrent start/takeover integration tests in `tests/integration/us3/idempotency.test.ts`.
- [X] T118 [P] [US3] Write failing clearQueue/abort, queue-withholding, crash injection, and outcome-unknown tests in `tests/integration/us3/recovery.test.ts`.
- [X] T119 [P] [US3] Write failing GUI approval center, stop confirmation, and unknown-state E2E tests in `tests/e2e/us3/safe-execution.spec.ts`.

### Implementation for User Story 3

- [X] T120 [US3] Implement execution-entered and final receipts for direct and nested tools in `packages/pi-adapter/src/tool-receipts.ts` and `apps/execution-worker/src/tools/wrapper.ts`.
- [X] T121 [US3] Implement preflight-versus-execution event mapping and sequential tool execution in `packages/pi-adapter/src/event-projector.ts` and `packages/pi-adapter/src/session-adapter.ts`.
- [X] T122 [US3] Implement stop transactions, self-managed FIFO snapshots, clearQueue-before-abort, withheld queues, and manual queue actions in `apps/runner-api/src/runs/stop-service.ts`.
- [X] T123 [US3] Implement lost-response command recovery and same-key/different-payload conflict handling in `apps/runner-api/src/commands/idempotency.ts`.
- [X] T124 [US3] Implement crash reconciliation, checkpoint/leaf alignment, unknown side-effect handling, and no-automatic-replay policy in `apps/runner-api/src/runs/recovery-service.ts` and `packages/pi-adapter/src/recovery.ts`.
- [X] T125 [US3] Implement desktop stop confirmation, queued-instruction handling, last-known-state, and no-blind-retry guidance in `apps/desktop/src/features/runs/StopRunDialog.tsx` and `apps/desktop/src/features/runs/UnknownOutcomePanel.tsx`.
- [X] T126 [US3] Add execution-egress restrictions and compromised-worker bypass tests in `deploy/docker/compose.yml` and `tests/security/us3/worker-boundary.test.ts`.
- [X] T127 [US3] Execute QS-03 and preserve file hashes, external counts, approval, queue, and crash evidence in `artifacts/validation/us3/` using `quickstart.md`.

**Checkpoint**: High-risk side effects are gated at the actual execution boundary, and unknown outcomes are never disguised or replayed.

## Phase 6: User Story 4 - 不中断现任操作者完成责任交接 (Priority: P4)

**Goal**: Recipients prepare privately with read-only, source-linked answers and accept responsibility only after understanding current risks, without interrupting the active run or polluting public history.

**Independent Test**: During a running shared task, perform private preparation, source-permission checks, background refresh, clarification publication, concurrent takeover, and acceptance/rejection. Maps to spec US4 and quickstart QS-04.

### Tests for User Story 4

- [X] T128 [P] [US4] Write failing handoff invitation, preparation, refresh, accept/reject, and takeover contract tests in `tests/contract/us4/handoffs.test.ts`.
- [X] T129 [P] [US4] Write failing private-QA isolation, recipient-permission, citation, and no-real-tool integration tests in `tests/integration/us4/private-preparation.test.ts`.
- [X] T130 [P] [US4] Write failing background-change, concurrent-takeover, offline-takeover, and forced-reason tests in `tests/integration/us4/operator-epoch.test.ts`.
- [X] T131 [P] [US4] Write failing running-handoff and private-preparation GUI E2E tests in `tests/e2e/us4/quiet-handoff.spec.ts`.

### Implementation for User Story 4

- [X] T132 [P] [US4] Create the HandoffInvitation model and migration in `packages/domain/src/handoff-invitation.ts` and `packages/persistence/schema/handoff-invitation.sql`; canonical fields per `data-model.md`: `HandoffInvitation.id`, `HandoffInvitation.workspaceId`, `HandoffInvitation.fromOperatorId`, `HandoffInvitation.recipientId`, `HandoffInvitation.summarySnapshotId`, `HandoffInvitation.baseRevision`, `HandoffInvitation.status`, `HandoffInvitation.reason?`, `HandoffInvitation.createdAt`, `HandoffInvitation.expiresAt?`.
- [X] T133 [P] [US4] Create the HandoffSummary model and migration in `packages/domain/src/handoff-summary.ts` and `packages/persistence/schema/handoff-summary.sql`; canonical fields per `data-model.md`: `HandoffSummary.id`, `HandoffSummary.workspaceId`, `HandoffSummary.revision`, `HandoffSummary.goal`, `HandoffSummary.criteria`, `HandoffSummary.runState`, `HandoffSummary.decisions[]`, `HandoffSummary.completedWork[]`, `HandoffSummary.pendingApprovalIds[]`, `HandoffSummary.queueIds[]`, `HandoffSummary.todoIds[]`, `HandoffSummary.artifactIds[]`, `HandoffSummary.blockers[]`, `HandoffSummary.grantIds[]`.
- [X] T134 [P] [US4] Create the PreparationSession model and migration in `packages/domain/src/preparation-session.ts` and `packages/persistence/schema/preparation-session.sql`; canonical fields per `data-model.md`: `PreparationSession.id`, `PreparationSession.handoffId`, `PreparationSession.recipientId`, `PreparationSession.readOnlyConversationId`, `PreparationSession.asOfRevision`, `PreparationSession.latestRevision`, `PreparationSession.status`, `PreparationSession.startedAt`, `PreparationSession.endedAt?`.
- [X] T135 [P] [US4] Create the PrivateQA model and migration in `packages/domain/src/private-qa.ts` and `packages/persistence/schema/private-qa.sql`; canonical fields per `data-model.md`: `PrivateQA.id`, `PrivateQA.preparationSessionId`, `PrivateQA.question`, `PrivateQA.answer`, `PrivateQA.asOfRevision`, `PrivateQA.answerKind`, `PrivateQA.createdAt`.
- [X] T136 [P] [US4] Create the Citation model and migration in `packages/domain/src/citation.ts` and `packages/persistence/schema/citation.sql`; canonical fields per `data-model.md`: `Citation.privateQAId`, `Citation.sourceType`, `Citation.sourceId`, `Citation.sourceRevision`, `Citation.recordedAt`.
- [X] T137 [P] [US4] Create the UnresolvedIssue model and migration in `packages/domain/src/unresolved-issue.ts` and `packages/persistence/schema/unresolved-issue.sql`; canonical fields per `data-model.md`: `UnresolvedIssue.id`, `UnresolvedIssue.preparationSessionId`, `UnresolvedIssue.body`, `UnresolvedIssue.visibility`, `UnresolvedIssue.status`.
- [X] T138 [P] [US4] Create the ClarificationPublication model and migration in `packages/domain/src/clarification-publication.ts` and `packages/persistence/schema/clarification-publication.sql`; canonical fields per `data-model.md`: `ClarificationPublication.id`, `ClarificationPublication.preparationSessionId`, `ClarificationPublication.targetType`, `ClarificationPublication.targetId`, `ClarificationPublication.editedBody`, `ClarificationPublication.publishedBy`, `ClarificationPublication.publishedAt`.
- [X] T139 [US4] Implement immutable handoff summaries and invitation/accept/reject flows without run interruption in `apps/runner-api/src/handoffs/service.ts` and `apps/runner-api/src/handoffs/summary.ts`.
- [X] T140 [US4] Implement offline eligibility, forced takeover reasons, and atomic operator-epoch transitions in `apps/runner-api/src/handoffs/takeover-service.ts`.
- [X] T141 [US4] Implement separate read-only preparation sessions and recipient-filtered retrieval without main-session prompts in `apps/runner-api/src/handoffs/preparation-service.ts` and `packages/pi-adapter/src/preparation-adapter.ts`.
- [X] T142 [US4] Implement sourced/speculative/unknown/permission-denied answers and citation verification in `apps/runner-api/src/handoffs/answer-service.ts`.
- [X] T143 [US4] Implement background revisions, mandatory pre-accept refresh, unresolved issues, and clarification publication in `apps/runner-api/src/handoffs/background-service.ts` and `apps/runner-api/src/handoffs/publication-service.ts`.
- [X] T144 [US4] Implement handoff, takeover, preparation, question, issue, refresh, publication, accept, and reject endpoints in `apps/runner-api/src/routes/handoffs.ts`.
- [X] T145 [US4] Implement the desktop handoff summary and responsibility-focused acceptance/rejection flow in `apps/desktop/src/features/handoffs/HandoffInvitation.tsx`.
- [X] T146 [US4] Implement the private preparation workspace, citations, background-change banner, and unresolved issues in `apps/desktop/src/features/handoffs/PreparationWorkspace.tsx` and `apps/desktop/src/features/handoffs/CitationList.tsx`.
- [X] T147 [US4] Implement clarification editing/publication and private-content retention choices in `apps/desktop/src/features/handoffs/ClarificationPublisher.tsx` and `apps/desktop/src/features/handoffs/PreparationExitDialog.tsx`.
- [X] T148 [US4] Implement preparation-duration and acceptance metadata metrics without private-question bodies in `apps/runner-api/src/telemetry/handoff-metrics.ts`.
- [X] T149 [US4] Execute QS-04 and preserve main-run continuity, private visibility, citations, and takeover evidence in `artifacts/validation/us4/` using `quickstart.md`.

**Checkpoint**: Handoff transfers responsibility without restarting work, and private preparation cannot alter or leak into the main task.

## Phase 7: User Story 5 - 交付有证据、可复核、可沉淀的结果 (Priority: P5)

**Goal**: Teams bind conclusions to evidence and review status, discover impact when sources change, and retain searchable, exportable archives with explicit gaps.

**Independent Test**: Link several conclusions and deliverables to one source, change or invalidate it, handle conflicts and completion exceptions, re-review, and export/read the archive without the product. Maps to spec US5 and quickstart QS-05.

### Tests for User Story 5

- [X] T150 [P] [US5] Write failing conclusion, source-state, review, and evidence-exception contract tests in `tests/contract/us5/evidence.test.ts`.
- [X] T151 [P] [US5] Write failing source-change impact, conflict, expiry, and re-confirmation integration tests in `tests/integration/us5/evidence-impact.test.ts`.
- [X] T152 [P] [US5] Write failing completion-gate, archive export, missing-object, and unknown-item tests in `tests/integration/us5/archive-export.test.ts`.
- [X] T153 [P] [US5] Write failing evidence review and archive-reading GUI E2E tests in `tests/e2e/us5/evidence-archive.spec.ts`.

### Implementation for User Story 5

- [X] T154 [P] [US5] Create the Conclusion model and migration in `packages/domain/src/conclusion.ts` and `packages/persistence/schema/conclusion.sql`; canonical fields per `data-model.md`: `Conclusion.id`, `Conclusion.workspaceId`, `Conclusion.kind`, `Conclusion.body`, `Conclusion.state`, `Conclusion.scope`, `Conclusion.proposedBy`, `Conclusion.confirmedBy?`, `Conclusion.confirmedAt?`, `Conclusion.currentVersion`, `Conclusion.lastReviewedAt?`.
- [X] T155 [P] [US5] Create the EvidenceSource model and migration in `packages/domain/src/evidence-source.ts` and `packages/persistence/schema/evidence-source.sql`; canonical fields per `data-model.md`: `EvidenceSource.id`, `EvidenceSource.workspaceId`, `EvidenceSource.originType`, `EvidenceSource.originId`, `EvidenceSource.currentVersionId`, `EvidenceSource.state`, `EvidenceSource.lastConfirmedAt`, `EvidenceSource.reviewDueAt?`, `EvidenceSource.externalMonitoring`.
- [X] T156 [P] [US5] Create the SourceVersion model and migration in `packages/domain/src/source-version.ts` and `packages/persistence/schema/source-version.sql`; canonical fields per `data-model.md`: `SourceVersion.id`, `SourceVersion.sourceId`, `SourceVersion.version`, `SourceVersion.contentRef`, `SourceVersion.contentDigest`, `SourceVersion.recordedAt`, `SourceVersion.supersedesId?`.
- [X] T157 [P] [US5] Create the EvidenceLink model and migration in `packages/domain/src/evidence-link.ts` and `packages/persistence/schema/evidence-link.sql`; canonical fields per `data-model.md`: `EvidenceLink.conclusionId`, `EvidenceLink.sourceVersionId`, `EvidenceLink.relation`, `EvidenceLink.createdBy`, `EvidenceLink.createdAt`.
- [X] T158 [P] [US5] Create the ConclusionImpact model and migration in `packages/domain/src/conclusion-impact.ts` and `packages/persistence/schema/conclusion-impact.sql`; canonical fields per `data-model.md`: `ConclusionImpact.id`, `ConclusionImpact.conclusionId`, `ConclusionImpact.targetType`, `ConclusionImpact.targetId`, `ConclusionImpact.impactKind`, `ConclusionImpact.state`.
- [X] T159 [P] [US5] Create the ReviewRecord model and migration in `packages/domain/src/review-record.ts` and `packages/persistence/schema/review-record.sql`; canonical fields per `data-model.md`: `ReviewRecord.id`, `ReviewRecord.conclusionId`, `ReviewRecord.previousState`, `ReviewRecord.newState`, `ReviewRecord.reason`, `ReviewRecord.sourceVersionIds[]`, `ReviewRecord.reviewedBy`, `ReviewRecord.reviewedAt`.
- [X] T160 [P] [US5] Create the EvidenceException model and migration in `packages/domain/src/evidence-exception.ts` and `packages/persistence/schema/evidence-exception.sql`; canonical fields per `data-model.md`: `EvidenceException.id`, `EvidenceException.runId`, `EvidenceException.conclusionIds[]`, `EvidenceException.reason`, `EvidenceException.approvedBy`, `EvidenceException.createdAt`.
- [X] T161 [P] [US5] Create the ArchiveExport model and migration in `packages/domain/src/archive-export.ts` and `packages/persistence/schema/archive-export.sql`; canonical fields per `data-model.md`: `ArchiveExport.id`, `ArchiveExport.workspaceId`, `ArchiveExport.scope`, `ArchiveExport.formatVersion`, `ArchiveExport.manifestBlobId`, `ArchiveExport.missingItems[]`, `ArchiveExport.unknownItems[]`, `ArchiveExport.exportedBy`, `ArchiveExport.exportedAt`.
- [X] T162 [US5] Implement conclusion proposal, human confirmation, evidence links, scope, and status transitions in `apps/runner-api/src/evidence/conclusion-service.ts`.
- [X] T163 [US5] Implement immutable source versions, review due dates, conflicts, revocation, and external-source last-confirmed semantics in `apps/runner-api/src/evidence/source-service.ts`.
- [X] T164 [US5] Implement impact-graph traversal, direct-dependency review marking, single-source notification, and non-reversal behavior in `apps/runner-api/src/evidence/impact-service.ts`.
- [X] T165 [US5] Implement re-review history, evidence coverage, completion blocking, partial completion, and owner exceptions in `apps/runner-api/src/evidence/completion-gate.ts`.
- [X] T166 [US5] Implement archive search, manifest generation, artifact correspondence, redacted exports, and missing/unknown annotations in `apps/runner-api/src/archive/service.ts` and `apps/runner-api/src/archive/exporter.ts`.
- [X] T167 [US5] Implement conclusion, source-state, review, completion-assessment, and archive-export endpoints in `apps/runner-api/src/routes/evidence.ts` and `apps/runner-api/src/routes/archive.ts`.
- [X] T168 [US5] Implement the desktop current-conclusions and review-required views with sources and impact details in `apps/desktop/src/features/evidence/ConclusionBoard.tsx` and `apps/desktop/src/features/evidence/ImpactReview.tsx`.
- [X] T169 [US5] Implement desktop evidence-exception completion and non-destructive review history in `apps/desktop/src/features/evidence/CompletionAssessment.tsx`.
- [X] T170 [US5] Implement desktop archive search, export scope, missing/unknown indicators, and external-readable manifest download in `apps/desktop/src/features/archive/ArchiveExplorer.tsx`.
- [X] T171 [US5] Execute QS-05 and preserve impact, review, exception, and independent archive evidence in `artifacts/validation/us5/` using `quickstart.md`.

**Checkpoint**: Users can verify why a conclusion is trusted, what source changes affect, and what happened during the task after archiving.

## Phase 8: User Story 6 - 按任务贡献跨设备、跨所有者的环境能力 (Priority: P6，Federated Beta)

**Goal**: Owners contribute explicit snapshots or fixed tools through default-off, three-level Beta enablement while retaining local authorization, propagation control, budgets, revocation, and isolation. B0 delivers a closed read-only Beta independently; B1 adds fixed tools, Patch, and cross-domain Artifact transfer only after B0 passes.

**Independent Test**: B0 uses two owners to prove pairing, snapshots, model/member visibility, local Grant decisions, revocation, offline/restart replay, and Stable isolation without fixed tools or Patch. B1 then proves fixed tools, Patch, cross-domain Artifact transfer, budgets, and malicious-node handling. Each stage has a separate release checkpoint and evidence directory.

### Tests for User Story 6 - B0 Closed Read-Only Beta

- [X] T172 [P] [US6] Create malicious-node and owner-control fixtures without fixed-tool or Patch dependencies in `packages/test-support/src/federation/fixtures.ts` and `packages/test-support/fixtures/federation/`.
- [X] T173 [P] [US6] Write failing pairing, mTLS, long-poll, OperationTicket, and capability contract tests in `tests/contract/us6/node-pairing.test.ts`.
- [X] T174 [P] [US6] Write failing owner-signed Grant approval/rejection/reduction, local-final-decision, expiry, revocation, and replay tests in `tests/contract/us6/grants.test.ts`.
- [X] T175 [P] [US6] Write failing snapshot scope, pathVisibility, symlink/TOCTOU, and fixed-version integration tests in `tests/integration/us6/snapshots.test.ts`.
- [X] T176 [P] [US6] Write failing model/member/public visibility and derived-label intersection tests without cross-domain Artifact transfer in `tests/integration/us6/propagation.test.ts`.
- [X] T177 [P] [US6] Write failing receipt backfill/gaps, malicious-node, node-handoff, and Stable-isolation tests in `tests/integration/us6/recovery-and-isolation.test.ts`.
- [X] T178 [P] [US6] Write failing two-owner, five-node/twenty-Grant, owner-control, and Beta-disabled GUI E2E tests in `tests/e2e/us6/federated-workspace.spec.ts`.
- [X] T179 [P] [US6] Write failing cross-node prompt-injection to evidence-review integration tests in `tests/integration/us6/injection-conclusion-review.test.ts`.

### Implementation for User Story 6 - B0

- [X] T180 [US6] Initialize the shared Rust security core and contributor node crates only after Stable validation in `packages/rust-security-core/Cargo.toml` and `apps/contributor-node/Cargo.toml`.
- [X] T181 [P] [US6] Implement DataRights shared value objects in `packages/contracts/src/data-rights.ts`; cite `data-model.md` §1 fields `DataRights.modelDisclose`, `DataRights.memberDisclose`, `DataRights.publicTimeline`, `DataRights.domainPropagate`, `DataRights.centralCache`, and `DataRights.offlineRead`.
- [X] T182 [P] [US6] Implement RecipientRules, ModelRecipient, CachePolicy, and ResourceBudget shared schemas in `packages/contracts/src/recipient-rules.ts` and `packages/contracts/src/resource-budget.ts`; cite `data-model.md` §1 plus `Grant.recipientRules`, `Grant.rights`, `Grant.budget`, `Grant.cachePolicy`, and `ToolExecution.resourceBudget`.
- [X] T183 [P] [US6] Create the ContributorNode model and migration in `apps/contributor-node/src/domain/contributor_node.rs` and `apps/contributor-node/src/storage/schema/contributor-node.sql`; canonical fields per `data-model.md`: `ContributorNode.id`, `ContributorNode.ownerId`, `ContributorNode.teamId`, `ContributorNode.name`, `ContributorNode.publicKey`, `ContributorNode.ownerApprovalPublicKey`, `ContributorNode.platform`, `ContributorNode.agentVersion`, `ContributorNode.state`, `ContributorNode.supportState`, `ContributorNode.securityPosture`, `ContributorNode.capabilities`, `ContributorNode.policyRevision`, `ContributorNode.lastHeartbeatAt`.
- [X] T184 [P] [US6] Create the ResourceRegistration model and migration in `apps/contributor-node/src/domain/resource_registration.rs` and `apps/contributor-node/src/storage/schema/resource-registration.sql`; canonical fields per `data-model.md`: `ResourceRegistration.id`, `ResourceRegistration.nodeId`, `ResourceRegistration.kind`, `ResourceRegistration.localAlias`, `ResourceRegistration.displayMetadata`, `ResourceRegistration.allowedOperations`, `ResourceRegistration.templateDigest?`, `ResourceRegistration.registeredAt`.
- [X] T185 [P] [US6] Create the SnapshotManifest model and migration in `apps/contributor-node/src/domain/snapshot_manifest.rs` and `apps/contributor-node/src/storage/schema/snapshot-manifest.sql`; canonical fields per `data-model.md`: `SnapshotManifest.id`, `SnapshotManifest.nodeId`, `SnapshotManifest.resourceId`, `SnapshotManifest.rootDigest`, `SnapshotManifest.entries[]`, `SnapshotManifest.createdAt`, `SnapshotManifest.pathVisibility`, `SnapshotManifest.cachePolicy`, `SnapshotManifest.state`.
- [X] T186 [P] [US6] Create the Grant shared contract and local migration in `packages/contracts/src/grant.ts` and `apps/contributor-node/src/storage/schema/grant.sql`; canonical fields per `data-model.md`: `Grant.id`, `Grant.nodeId`, `Grant.ownerId`, `Grant.teamId`, `Grant.workspaceId`, `Grant.runId`, `Grant.purposeDigest`, `Grant.resourceId`, `Grant.resourceDigest`, `Grant.operations[]`, `Grant.requesterIds[]`, `Grant.recipientRules`, `Grant.rights`, `Grant.notBefore`, `Grant.expiresAt`, `Grant.usageLimit`, `Grant.budget`, `Grant.cachePolicy`, `Grant.handoffPolicy`, `Grant.policyRevision`, `Grant.ownerSignature`, `Grant.state`.
- [X] T187 [P] [US6] Create the OperationTicket shared contract and validator in `packages/contracts/src/operation-ticket.ts` and `packages/rust-security-core/src/operation_ticket.rs`; canonical fields per `data-model.md`: `OperationTicket.requestId`, `OperationTicket.nonce`, `OperationTicket.executionId`, `OperationTicket.nodeId`, `OperationTicket.runId`, `OperationTicket.grantDigest`, `OperationTicket.actionDigest`, `OperationTicket.recipientDigest`, `OperationTicket.bodyDigest`, `OperationTicket.notBefore`, `OperationTicket.expiresAt`, `OperationTicket.signature`.
- [X] T188 [P] [US6] Create the NodeOperation model and migration in `apps/contributor-node/src/domain/node_operation.rs` and `apps/contributor-node/src/storage/schema/node-operation.sql`; canonical fields per `data-model.md`: `NodeOperation.id`, `NodeOperation.requestId`, `NodeOperation.nodeId`, `NodeOperation.grantId`, `NodeOperation.executionId`, `NodeOperation.kind`, `NodeOperation.state`, `NodeOperation.authorizedAt`, `NodeOperation.dispatchedAt?`, `NodeOperation.completedAt?`, `NodeOperation.unknownReason?`, `NodeOperation.resultDigest?`.
- [X] T189 [P] [US6] Create the NodeArtifact model and migration in `packages/contracts/src/node-artifact.ts` and `apps/contributor-node/src/storage/schema/node-artifact.sql`; canonical fields per `data-model.md`: `NodeArtifact.id`, `NodeArtifact.originNodeIds[]`, `NodeArtifact.originOwnerIds[]`, `NodeArtifact.originGrantDigests[]`, `NodeArtifact.derivedFrom[]`, `NodeArtifact.contentDigest`, `NodeArtifact.securityLabelId`, `NodeArtifact.createdAt`.
- [X] T190 [P] [US6] Create the NodeReceipt shared contract and local migration in `packages/contracts/src/node-receipt.ts` and `apps/contributor-node/src/storage/schema/node-receipt.sql`; canonical fields per `data-model.md`: `NodeReceipt.eventId`, `NodeReceipt.nodeId`, `NodeReceipt.nodeSequence`, `NodeReceipt.previousDigest`, `NodeReceipt.runId`, `NodeReceipt.requestId`, `NodeReceipt.executionId?`, `NodeReceipt.actor`, `NodeReceipt.resourceDigest`, `NodeReceipt.operation`, `NodeReceipt.grantDigest`, `NodeReceipt.decision`, `NodeReceipt.reason`, `NodeReceipt.occurredAt`, `NodeReceipt.result`, `NodeReceipt.byteCount`, `NodeReceipt.destinations[]`, `NodeReceipt.labelDigest`, `NodeReceipt.uploadState`, `NodeReceipt.nodeSignature`.
- [X] T191 [P] [US6] Create the ReceiptGap model and migration in `apps/contributor-node/src/domain/receipt_gap.rs` and `apps/contributor-node/src/storage/schema/receipt-gap.sql`; canonical fields per `data-model.md`: `ReceiptGap.nodeId`, `ReceiptGap.fromSequence`, `ReceiptGap.toSequence`, `ReceiptGap.detectedAt`, `ReceiptGap.reason`, `ReceiptGap.resolvedAt?`.
- [X] T192 [P] [US6] Create the NodePolicyState model and migration in `apps/contributor-node/src/domain/node_policy_state.rs` and `apps/contributor-node/src/storage/schema/node-policy-state.sql`; canonical fields per `data-model.md`: `NodePolicyState.nodeId`, `NodePolicyState.stateRevision`, `NodePolicyState.betaEnabled`, `NodePolicyState.pauseState`, `NodePolicyState.quarantineState`, `NodePolicyState.revocationTombstones[]`, `NodePolicyState.deniedIntentDigests[]`, `NodePolicyState.budgetWatermarks`.
- [X] T193 [P] [US6] Create the RevocationDirective shared contract and Rust validator in `packages/contracts/src/revocation-directive.ts` and `packages/rust-security-core/src/revocation_directive.rs`; canonical fields per `data-model.md`: `RevocationDirective.id`, `RevocationDirective.targetType`, `RevocationDirective.targetId`, `RevocationDirective.stateRevision`, `RevocationDirective.effectiveAt`, `RevocationDirective.reason`, `RevocationDirective.scope`, `RevocationDirective.ownerOrSecuritySignature`.
- [X] T194 [US6] Implement global/team/workspace/node Beta gates and non-expanding upgrade behavior in `apps/runner-api/src/federation/gates.ts` and `apps/contributor-node/src/policy/gates.rs`.
- [X] T195 [US6] Implement owner/node key generation, one-time pairing, certificate rotation, and unknown-security-posture registration in `apps/runner-api/src/federation/pairing.ts` and `apps/contributor-node/src/identity/pairing.rs`.
- [X] T196 [US6] Implement outbound mTLS HTTPS long polling, backoff, capability negotiation, and no-inbound-listener behavior in `apps/contributor-node/src/transport/long_poll.rs` and `apps/runner-api/src/federation/long-poll.ts`.
- [X] T197 [US6] Implement owner-signed Grant approval/rejection/reduction/revocation and persistent local terminal states in `apps/runner-api/src/federation/grant-service.ts` and `apps/contributor-node/src/policy/grants.rs`.
- [X] T198 [US6] Implement OperationTicket validation, nonce/request deduplication, execution intents, and one-time local leases in `apps/contributor-node/src/policy/operation-tickets.rs` and `apps/contributor-node/src/policy/leases.rs`.
- [X] T199 [US6] Implement owner resource registration and snapshot preview with explicit inclusion and independent pathVisibility in `apps/contributor-node/src/resources/registration.rs` and `apps/contributor-node/src/snapshots/preview.rs`.
- [X] T200 [US6] Implement safe relative-handle snapshot traversal, symlink/device/cross-mount/unconfirmed-hardlink rejection, immutable private copies, and manifest hashing in `apps/contributor-node/src/snapshots/builder.rs` and `apps/contributor-node/src/snapshots/store.rs`.
- [X] T201 [US6] Implement snapshot entry reads, central-cache/offline permissions, source-change detection, and metadata filtering in `apps/contributor-node/src/snapshots/reader.rs` and `apps/runner-api/src/federation/cache.ts`.
- [X] T202 [US6] Implement strict SecurityLabel merging, denied-intent records, and owner-reviewed downgrade versions in `packages/security/src/labels.ts` and `apps/runner-api/src/federation/propagation.ts`.
- [X] T203 [US6] Implement model-egress permission checks and cross-node prompt-injection GrantProposal handling in `apps/model-gateway/src/egress-policy.ts` and `apps/runner-api/src/federation/injection-guard.ts`.
- [X] T204 [US6] Link untrusted-node injection outcomes to concrete Conclusion review records in `apps/runner-api/src/evidence/injection-review.ts` and `apps/runner-api/src/federation/injection-guard.ts`.
- [X] T205 [US6] Implement append-only signed receipts, idempotent backfill, read-only uploadState projection, and receipt-gap detection in `apps/contributor-node/src/receipts/log.rs` and `apps/runner-api/src/federation/receipts.ts`.
- [X] T206 [US6] Implement pause/revoke/quarantine directives, local-only unquarantine, cancellation, and outcome-unknown recovery in `apps/contributor-node/src/policy/directives.rs` and `apps/contributor-node/src/operations/recovery.rs`.
- [X] T207 [US6] Implement multi-node step dependencies, no-private-reassignment, budgets, read-only federated handoff Grant retention, and no private-data inheritance in `apps/runner-api/src/federation/coordinator.ts` and `apps/runner-api/src/federation/handoff.ts`.
- [X] T208 [US6] Implement node, resource, snapshot, Grant, activity, receipt, and export REST endpoints in `apps/runner-api/src/routes/federation.ts`.
- [X] T209 [US6] Implement the desktop “我的环境” view with node states, active exposure, data destinations, and pause/revoke/isolate controls in `apps/desktop/src/features/federation/EnvironmentDashboard.tsx`.
- [X] T210 [US6] Implement desktop Grant request/approval/rejection/reduction, separate data-rights choices, and concrete consequence labels in `apps/desktop/src/features/federation/GrantEditor.tsx`.
- [X] T211 [US6] Implement desktop snapshot preview and pathVisibility without Patch controls in `apps/desktop/src/features/federation/SnapshotPreview.tsx`.
- [X] T212 [US6] Implement desktop activity receipts, gaps, and restricted-result states without cross-domain transfer controls in `apps/desktop/src/features/federation/ReceiptExplorer.tsx` and `apps/desktop/src/features/federation/RestrictedResult.tsx`.
- [X] T213 [US6] Implement Beta support-matrix, known-limit, security-boundary, feedback, and emergency-disable views in `apps/desktop/src/features/federation/BetaSupport.tsx` and `deploy/support-matrix/beta.md`.
- [X] T214 [US6] Execute only QS-07 and QS-08 and preserve closed read-only Beta evidence in `artifacts/validation/beta-b0/` using `quickstart.md` and `uat-catalog.md`.

**Checkpoint B0**: Closed read-only Beta passes independently with no fixed-tool or Patch implementation; Stable remains fully usable when every Beta component is absent or disabled.

### Tests for User Story 6 - B1 Fixed Tools, Patch, and Cross-Domain Artifacts

- [X] T215 [P] [US6] Write failing fixed-tool, clean-environment, budget, arbitrary-command, and network-budget tests in `tests/integration/us6/fixed-tools.test.ts`.
- [X] T216 [P] [US6] Write failing Patch conflict, independent-application, partial-application, and no-writeback tests in `tests/integration/us6/patch.test.ts`.
- [X] T217 [P] [US6] Write failing cross-domain Artifact transfer, dual-approval, and derived-label tests in `tests/integration/us6/artifact-transfer.test.ts`.
- [X] T218 [P] [US6] Write failing federated archive aggregation and offline-reading tests in `tests/integration/us6/archive-export.test.ts`.
- [X] T219 [P] [US6] Write failing two-owner, five-node/twenty-Grant, owner-control, and Beta-disabled GUI E2E tests in `tests/e2e/us6/federated-workspace.spec.ts`.

### Implementation for User Story 6 - B1
- [X] T220 [P] [US6] Create the FixedToolTemplate model and migration in `apps/contributor-node/src/domain/fixed_tool_template.rs` and `apps/contributor-node/src/storage/schema/fixed-tool-template.sql`; canonical fields per `data-model.md`: `FixedToolTemplate.id`, `FixedToolTemplate.nodeId`, `FixedToolTemplate.version`, `FixedToolTemplate.digest`, `FixedToolTemplate.displayName`, `FixedToolTemplate.purpose`, `FixedToolTemplate.executableDigest`, `FixedToolTemplate.parameterSchema`, `FixedToolTemplate.workingScope`, `FixedToolTemplate.envAllowlist`, `FixedToolTemplate.networkPolicy`, `FixedToolTemplate.outputLimit`, `FixedToolTemplate.sideEffectClass`, `FixedToolTemplate.budget`.
- [X] T221 [P] [US6] Create the ToolExecution model and migration in `apps/contributor-node/src/domain/tool_execution.rs` and `apps/contributor-node/src/storage/schema/tool-execution.sql`; canonical fields per `data-model.md`: `ToolExecution.id`, `ToolExecution.nodeOperationId`, `ToolExecution.templateDigest`, `ToolExecution.canonicalArgs`, `ToolExecution.resourceBudget`, `ToolExecution.state`, `ToolExecution.startedAt`, `ToolExecution.endedAt?`, `ToolExecution.outputArtifactId?`.
- [X] T222 [P] [US6] Create the PatchProposal shared contract and Rust model in `packages/contracts/src/patch-proposal.ts` and `apps/contributor-node/src/patch/proposal.rs`; canonical fields per `data-model.md`: `PatchProposal.id`, `PatchProposal.nodeId`, `PatchProposal.baseSnapshotId`, `PatchProposal.baseManifestDigest`, `PatchProposal.fileChanges[]`, `PatchProposal.runId`, `PatchProposal.purposeDigest`, `PatchProposal.patchDigest`, `PatchProposal.securityLabelId`, `PatchProposal.state`.
- [X] T223 [P] [US6] Create the PatchApplication model and migration in `apps/contributor-node/src/patch/application.rs` and `apps/contributor-node/src/storage/schema/patch-application.sql`; canonical fields per `data-model.md`: `PatchApplication.id`, `PatchApplication.patchId`, `PatchApplication.independentGrantId`, `PatchApplication.preconditionDigests[]`, `PatchApplication.journalRef`, `PatchApplication.resultByFile[]`, `PatchApplication.appliedBy`, `PatchApplication.startedAt`, `PatchApplication.completedAt?`.
- [X] T224 [US6] Implement fixed-template registration, digest binding, schema-limited parameters, and template-change reauthorization in `apps/contributor-node/src/tools/registry.rs`.
- [X] T225 [US6] Implement clean fixed-tool sandboxes, empty environment allowlists, no default network, process-group timeout, and resource budgets in `apps/contributor-node/src/tools/sandbox.rs` and `apps/contributor-node/src/tools/budget.rs`.
- [X] T226 [US6] Implement Patch generation from base snapshots, conflict checks, independent local application, journals, and new-version evidence in `apps/contributor-node/src/patch/generator.rs` and `apps/contributor-node/src/patch/applier.rs`.
- [X] T227 [US6] Implement recipient-specific Artifact exports and cross-domain propagation approval in `apps/runner-api/src/federation/propagation.ts` and `apps/runner-api/src/federation/artifact-transfer.ts`.
- [X] T228 [US6] Implement Patch REST endpoints and high-risk Grant reconfirmation during federated handoff in `apps/runner-api/src/routes/federation.ts` and `apps/runner-api/src/federation/handoff.ts`.
- [X] T229 [US6] Implement desktop Patch conflict review, independent local application, and source-to-recipient propagation approval in `apps/desktop/src/features/federation/PatchReview.tsx` and `apps/desktop/src/features/federation/PropagationReview.tsx`.
- [X] T230 [US6] Extend the archive exporter with nodes, snapshots, Grants, execution versions, propagation chains, and revoked/invalid/unavailable states in `apps/runner-api/src/federation/archive-exporter.ts` and `apps/runner-api/src/archive/manifest.ts`.
- [X] T231 [US6] Execute only QS-09 and QS-10 and preserve fixed-tool, Patch, cross-domain, archive, and public-Beta evidence in `artifacts/validation/beta-b1/` using `quickstart.md` and `uat-catalog.md`.

**Checkpoint B1**: Fixed tools, Patch, and cross-domain Artifact transfer pass only after B0 evidence exists; each stage has an independent release decision and neither can silently expand the other.

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Complete P1 conveniences, cross-story performance, accessibility, operations, compliance, and full validation without weakening P0 scope or security gates.

- [X] T232 Write failing notification, template, statistics, performance, and release contract tests in `tests/contract/polish/` before implementing P1 conveniences.
- [X] T233 Write failing operations, backup-upgrade, validation-catalog completeness, and release-evidence integration tests in `tests/integration/polish/` before implementing P1 conveniences.
- [X] T234 [P] Implement approval, handoff, mention, completion, failure, and needs-confirmation notifications in `apps/runner-api/src/notifications/service.ts` and `apps/desktop/src/features/notifications/NotificationCenter.tsx`.
- [X] T235 [P] Implement reusable goal, context, and approval task templates in `apps/runner-api/src/templates/service.ts` and `apps/desktop/src/features/templates/TemplateEditor.tsx`.
- [X] T236 [P] Implement cross-task duration, collaboration, handoff, approval, and reliable-cost statistics in `apps/runner-api/src/statistics/service.ts` and `apps/desktop/src/features/statistics/WorkspaceStatistics.tsx`.
- [X] T237 Add long-history keyset, overview projections, search indexing, output coalescing, and slow-client backpressure in `apps/runner-api/src/projections/overview.ts` and `apps/runner-api/src/events/sse.ts`.
- [X] T238 Complete keyboard operation, focus visibility, themes, density, long-output accessibility, and non-color risk cues in `apps/desktop/src/accessibility/` and `apps/desktop/src/features/runs/RunTimeline.tsx`.
- [X] T239 [P] Write installation, backup, restore, upgrade, permissions, and failure guides in `docs/operations/install.md`, `docs/operations/backup.md`, and `docs/operations/recovery.md`.
- [X] T240 [P] Write the threat model, support matrix, Grant/data-flow, revocation/isolation, incident, and security-announcement documents in `deploy/support-matrix/` and `docs/security/`.
- [X] T241 Reconcile every accepted deviation and record implementation evidence in `research.md` and `docs/architecture/deviations.md`.
- [X] T242 Run dependency, asset, container, secret, license, and PI-Desktop similarity release checks in `scripts/check-release.mjs` and `docs/design/provenance.md`.
- [X] T243 Execute every Stable UAT-01–31 case through the per-ID registry and verify no scenario is skipped and preserve results in `artifacts/validation/stable/` using `quickstart.md`.
- [X] T244 Execute every Beta UAT-32–60 case through the per-ID registry and run independent local-denial checks in `artifacts/validation/beta/` using `quickstart.md`.
- [X] T245 Execute long-history, five-client, five-node, twenty-Grant, and slow-node performance validation in `artifacts/validation/performance/`.
- [X] T246 Run independent threat-model and third-party security review records in `docs/security/reviews/` before Federated GA consideration.
- [X] T247 Produce final Stable and Beta release-gate reports without converting unexecuted checks into passes in `artifacts/validation/release-gates.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; starts immediately.
- **Phase 2 Foundational**: Depends on Setup and blocks every user-story phase.
- **Phase 3 US1**: Depends on Phase 2; is the MVP and must be validated before shared collaboration.
- **Phase 4 US2**: Depends on Phase 3 for personal tasks, sessions, runs, and artifacts.
- **Phase 5 US3**: Depends on Phase 3 baseline run/approval models and Phase 2 execution boundaries; can harden after US1 without changing US2 semantics.
- **Phase 6 US4**: Depends on Phases 3–5 for active shared runs, operator control, and recovery states.
- **Phase 7 US5**: Depends on Phases 3–4 for runs/artifacts; integrates with US3 pending approvals and US4 handoff evidence but remains independently testable.
- **Phase 8 US6**: Depends on Phases 2–7 for Stable contracts; B0 must pass its closed read-only gate before B1 starts. Fixed tools and Patch are never prerequisites for B0, and neither Beta stage may block Stable completion.
- **Phase 9 Polish**: Depends on all desired story phases and their story-specific validation evidence.

### User Story Dependencies

- **US1 (P1)**: No dependency on another story; independently delivers the personal MVP.
- **US2 (P2)**: Integrates with US1 personal history and artifacts, but test fixtures can construct them independently.
- **US3 (P3)**: Uses the complete US1 approval API/GUI and adds team approval adversarial checks, stop, idempotency, and recovery behavior; no baseline approval duplication.
- **US4 (P4)**: Uses US2 shared workspaces and US3 active-run states, with independently constructible handoff fixtures.
- **US5 (P5)**: Uses existing runs/artifacts and supplies evidence links to US3 approvals and US4 decisions without requiring those stories to be deployed together.
- **US6 (P6)**: Uses Stable contracts but has independent Rust node fixtures and a separate Beta release gate.

### Within Each User Story

- Contract, integration, and E2E tests MUST be written and observed failing before implementation.
- Canonical models and migrations precede domain services.
- Domain services precede REST/internal endpoints and desktop workflows.
- Story-specific validation must pass before marking the story complete or starting dependent integration.
- A red security, privacy, persistence, or recovery test blocks the affected story and any dependent release.

### Parallel Opportunities

- Setup shell, Runner, Rust, Docker, compliance, and test-harness tasks can proceed in parallel.
- Foundational entity tasks are parallel because each uses different model/schema files.
- Each story's test files can be authored in parallel before implementation.
- Entity tasks within each story are parallel because each uses different files.
- US2 team administration and context/collaboration services can proceed in parallel after their models.
- US3 approval-boundary, recovery, and desktop safety tasks can proceed in parallel after shared run services stabilize.
- US4 private preparation and operator-epoch services can proceed in parallel after handoff models.
- US5 evidence impact and archive export can proceed in parallel after evidence/artifact models.
- US6 node transport, snapshot, fixed-tool, propagation, receipt, and desktop workstreams can proceed in parallel after shared contracts.
- Stable and Beta release validation can proceed independently once their story gates are complete.

---

## Parallel Example: User Story 1

```bash
Task: "Write failing personal-task and run API contract tests in tests/contract/us1/personal-runs.test.ts"
Task: "Write failing pi session and recovery contract tests in tests/contract/us1/pi-adapter.test.ts"
Task: "Create Run, AgentConversation, and ArtifactVersion models in their respective packages/domain/src/ and packages/persistence/schema/ files"
```

## Parallel Example: User Story 2

```bash
Task: "Write failing selective-sharing integration tests in tests/integration/us2/share-conversion.test.ts"
Task: "Write failing context-version tests in tests/integration/us2/context-versions.test.ts"
Task: "Create ContextItem, ContextVersion, and ShareConversion models in their respective domain/schema files"
```

## Parallel Example: User Story 3

```bash
Task: "Write failing zero-side-effect approval tests in tests/integration/us3/approval-boundary.test.ts"
Task: "Write failing crash and unknown-outcome tests in tests/integration/us3/recovery.test.ts"
Task: "Implement execution-entered receipts and approval UI in their respective worker and desktop files"
```

## Parallel Example: User Story 4

```bash
Task: "Write failing private-preparation tests in tests/integration/us4/private-preparation.test.ts"
Task: "Write failing operator-epoch tests in tests/integration/us4/operator-epoch.test.ts"
Task: "Create PreparationSession, PrivateQA, and Citation models in their respective domain/schema files"
```

## Parallel Example: User Story 5

```bash
Task: "Write failing source-impact tests in tests/integration/us5/evidence-impact.test.ts"
Task: "Write failing archive-export tests in tests/integration/us5/archive-export.test.ts"
Task: "Create Conclusion, EvidenceSource, and ConclusionImpact models in their respective domain/schema files"
```

## Parallel Example: User Story 6 - B0

```bash
Task: "Write failing snapshot traversal tests in tests/integration/us6/snapshots.test.ts"
Task: "Write failing Grant rejection and replay tests in tests/contract/us6/grants.test.ts"
Task: "Implement Grant, SnapshotManifest, SecurityLabel, and NodeReceipt contracts in their respective TypeScript/Rust files"
```

## Parallel Example: User Story 6 - B1

```bash
Task: "Write failing fixed-tool tests in tests/integration/us6/fixed-tools.test.ts"
Task: "Write failing Patch and cross-domain Artifact tests in tests/integration/us6/patch.test.ts and tests/integration/us6/artifact-transfer.test.ts"
Task: "Implement FixedToolTemplate, PatchApplication, and federated archive export in their respective node and Runner files"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup and Phase 2 Foundational infrastructure.
2. Complete all US1 tests and implementation while keeping teams, sharing, and federation disabled.
3. Observe every intended pre-implementation test failure, then pass QS-01 and US1 contract/integration/E2E tests.
4. Validate clean Docker installation, personal task completion, artifact persistence, cold backup, and resume.
5. Demonstrate or release the personal MVP only after no high-severity issue remains.

### Incremental Delivery

1. Setup + Foundational → validated execution and persistence platform.
2. US1 → personal MVP → independent validation.
3. US2 → selective sharing and team collaboration → independent validation.
4. US3 → execution safety and recovery → side-effect evidence.
5. US4 → quiet handoff → private-preparation evidence.
6. US5 → evidence and archive → independent archive evidence.
7. US6 B0 → independent closed read-only gate → B1 fixed tools/Patch and cross-domain Artifacts → independent local-denial and two-owner validation.
8. Polish → P1 conveniences, performance, documentation, compliance, and final release gates.

### Parallel Team Strategy

1. One group completes shared contracts, persistence, identity, and execution foundations.
2. After Phase 2, separate groups can build US1 execution, desktop UX, and validation fixtures without editing the same files.
3. After US1, collaboration, safety, handoff, and evidence workstreams can proceed with independently constructed fixtures while preserving dependency order for integration.
4. Federation splits into transport/Grant, snapshot/tools, propagation/receipts, and desktop workstreams after shared contracts stabilize.
5. Stable release proceeds even if Beta validation fails; Beta remains disabled until its independent gate passes.

---

## Notes

- `[P]` tasks use different files and have no dependency on another incomplete task.
- `[US1]`–`[US6]` map directly to the six prioritized stories in `spec.md`.
- Each story has an independent test criterion and runnable validation evidence path.
- Tests must fail for the expected missing behavior before implementation; never rewrite a failing safety expectation merely to obtain green.
- Canonical field references resolve to `data-model.md`; implementation-specific additions require a separate acceptance source and must not contradict the canonical model.
- pi SDK is not a security boundary. Worker/container and Rust local-policy boundaries must be tested with real files, processes, and network egress.
- Stable must remain releasable with every Beta component absent or disabled.
- B0 and B1 have independent test tasks, evidence directories, checkpoints, and release decisions; B1 cannot begin until B0 passes.
- Commit only when explicitly requested, after reviewing the exact changed paths and validation evidence.
