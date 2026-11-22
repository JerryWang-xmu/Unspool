import { createHash } from "node:crypto";
import type {
  SqliteDatabase,
  SqliteTransaction,
} from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import {
  type CommandIdempotencyService,
  createCommandIdempotencyService,
} from "../commands/idempotency.js";
import type { ContextService } from "../context/service.js";
import { type ProblemCode, ProblemError } from "../errors/problem.js";
import { loadWorkspaceAccess, type WorkspacesService } from "../workspaces/service.js";

export interface RunsServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly workspaces?: WorkspacesService | undefined;
  readonly context?: ContextService | undefined;
}

export interface RunCommandInput {
  readonly operatorEpoch: number;
  readonly body?: string;
  readonly contextSnapshotId?: string;
  readonly confirmedStop?: boolean;
  readonly payloadDigest: string;
}

export interface RunCommandResult<T> {
  readonly response: T;
  readonly replayed: boolean;
}

const RUN_SELECT = `
  SELECT r.id, r.workspace_id AS workspaceId, r.conversation_id AS conversationId, r.sequence,
         r.state, r.operator_epoch AS operatorEpoch, r.runner_id AS runnerId,
         r.context_snapshot_id AS contextSnapshotId, r.started_by AS startedBy,
         r.started_at AS startedAt, r.ended_at AS endedAt,
         r.last_known_checkpoint AS lastKnownCheckpoint, w.kind, w.owner_id
  FROM run r
  JOIN workspace w ON w.id = r.workspace_id
`;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ProblemError("invalid_request", { detail: `${field} is required.` });
  return value;
}

function epoch(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new ProblemError("invalid_request", {
      detail: "operatorEpoch must be a positive integer.",
    });
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new ProblemError("invalid_request", {
      detail: "payloadDigest must be a SHA-256 digest.",
    });
  return value;
}

async function ownedRun(
  transaction: SqliteTransaction,
  actorId: string,
  workspaceId: string,
  runId: string,
) {
  const rows = await transaction.query<Record<string, unknown>>(
    `${RUN_SELECT} WHERE r.id = ? AND r.workspace_id = ?`,
    [runId, workspaceId],
  );
  const run = rows[0];
  if (run === undefined) throw new ProblemError("not_found");
  if (run.kind === "personal") {
    if (run.owner_id !== actorId) throw new ProblemError("not_found");
  } else {
    await loadWorkspaceAccess(transaction, actorId, workspaceId);
  }
  return run;
}

async function assertOperator(
  transaction: SqliteTransaction,
  workspaceId: string,
  operatorEpoch: number,
) {
  const rows = await transaction.query<{ operator_epoch: number }>(
    "SELECT operator_epoch FROM workspace_control WHERE workspace_id = ?",
    [workspaceId],
  );
  if (rows[0] === undefined) throw new ProblemError("not_found");
  if (rows[0].operator_epoch !== operatorEpoch) throw new ProblemError("operator_changed");
}

async function assertRunCommandAuthority(
  transaction: SqliteTransaction,
  actorId: string,
  workspaceId: string,
): Promise<void> {
  const rows = await transaction.query<{ kind: string }>(
    "SELECT kind FROM workspace WHERE id = ?",
    [workspaceId],
  );
  if (rows[0]?.kind === "shared") {
    const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
    if (access.currentOperator.operatorId !== actorId) throw new ProblemError("permission_denied");
  }
}

function mapCommandError(error: unknown): never {
  if (error instanceof CommandRevisionConflictError) throw new ProblemError("revision_conflict");
  if (
    error instanceof Error &&
    /idx_run_one_active_per_workspace|UNIQUE constraint failed: run\.workspace_id/.test(
      error.message,
    )
  )
    throw new ProblemError("task_active");
  throw error;
}

export class RunsService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #workspaces: WorkspacesService | undefined;
  readonly #context: ContextService | undefined;

  constructor(options: RunsServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
    this.#workspaces = options.workspaces;
    this.#context = options.context;
  }

  async startRun(
    actorId: string,
    workspaceId: string,
    input: RunCommandInput,
    commandId: string,
  ): Promise<RunCommandResult<{ run: Record<string, unknown> }>> {
    const operatorEpoch = epoch(input.operatorEpoch);
    const payloadDigest = digest(input.payloadDigest);
    const runId = this.#newId();
    const contextSnapshotId =
      input.contextSnapshotId === undefined
        ? this.#newId()
        : requiredText(input.contextSnapshotId, "contextSnapshotId");
    const now = this.#now().toISOString();
    const run: Record<string, unknown> = {
      id: runId,
      workspaceId,
      conversationId: null,
      sequence: 1,
      state: "running",
      operatorEpoch,
      runnerId: null,
      contextSnapshotId,
      startedBy: actorId,
      startedAt: now,
      endedAt: null,
      lastKnownCheckpoint: null,
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response: { run },
        mutate: async (transaction) => {
          const workspaces = await transaction.query<{
            runner_id: string;
            status: string;
            kind: string;
            owner_id: string;
          }>("SELECT runner_id, status, kind, owner_id FROM workspace WHERE id = ?", [workspaceId]);
          const workspace = workspaces[0];
          if (workspace === undefined) throw new ProblemError("not_found");
          if (workspace.kind === "personal" && workspace.owner_id !== actorId)
            throw new ProblemError("not_found");
          if (workspace.status === "archived") throw new ProblemError("workspace_archived");
          if (workspace.kind === "shared") {
            if (this.#workspaces === undefined || this.#context === undefined)
              throw new ProblemError("internal_error");
            await this.#workspaces.assertCanStartRunInTransaction(
              transaction,
              actorId,
              workspaceId,
              operatorEpoch,
            );
          }
          await assertOperator(transaction, workspaceId, operatorEpoch);
          const active = await transaction.query<{ id: string }>(
            "SELECT id FROM run WHERE workspace_id = ? AND state IN ('created', 'running', 'waiting_approval', 'stopping', 'needs_confirmation')",
            [workspaceId],
          );
          if (active.length > 0) throw new ProblemError("task_active");
          const sequenceRow = await transaction.query<{ sequence: number }>(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run WHERE workspace_id = ?",
            [workspaceId],
          );
          run.sequence = sequenceRow[0]?.sequence ?? 1;
          run.runnerId = workspace.runner_id;
          const conversations = await transaction.query<{ id: string }>(
            "SELECT id FROM agent_conversation WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1",
            [workspaceId],
          );
          let conversationId = conversations[0]?.id;
          if (conversationId === undefined) {
            conversationId = this.#newId();
            await transaction.execute(
              "INSERT INTO agent_conversation (id, workspace_id, pi_session_ref, session_format_version, continuation_of_id, created_at) VALUES (?, ?, ?, 1, NULL, ?)",
              [conversationId, workspaceId, `sessions/${conversationId}.jsonl`, now],
            );
          }
          run.conversationId = conversationId;
          if (workspace.kind === "shared") {
            if (this.#context === undefined) throw new ProblemError("internal_error");
            const snapshot = await this.#context.createRunSnapshotInTransaction(
              transaction,
              runId,
              workspaceId,
            );
            run.contextSnapshotId = snapshot.snapshot.id;
          } else {
            await transaction.execute(
              "INSERT INTO task_context_snapshot (id, run_id, context_version_ids, rendered_digest, created_at) VALUES (?, ?, '[]', ?, ?)",
              [contextSnapshotId, runId, payloadDigest, now],
            );
          }
          await transaction.execute(
            `INSERT INTO run (id, workspace_id, conversation_id, sequence, state, operator_epoch, runner_id, context_snapshot_id, started_by, started_at, ended_at, last_known_checkpoint) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, NULL, NULL)`,
            [
              runId,
              workspaceId,
              conversationId,
              run.sequence,
              operatorEpoch,
              workspace.runner_id,
              run.contextSnapshotId,
              actorId,
              now,
            ],
          );
          await transaction.execute(
            "UPDATE workspace_control SET active_run_id = ?, active_run_epoch = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
            [runId, operatorEpoch, now, workspaceId],
          );
          if (workspace.kind === "shared" && workspace.status === "draft") {
            await transaction.execute(
              "UPDATE workspace SET status = 'active', revision = revision + 1 WHERE id = ?",
              [workspaceId],
            );
          }
          await transaction.execute(
            "INSERT INTO run_command (id, run_id, workspace_id, kind, payload, payload_digest, command_id, actor_id, operator_epoch, accepted_at, result_ref) VALUES (?, ?, ?, 'start', ?, ?, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              runId,
              workspaceId,
              JSON.stringify(input),
              payloadDigest,
              commandId,
              actorId,
              operatorEpoch,
              now,
              runId,
            ],
          );
        },
        events: [
          {
            type: "run.started",
            schemaVersion: 1,
            occurredAt: now,
            runId,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { runId, state: "running" },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      mapCommandError(error);
    }
  }

  async getRun(
    actorId: string,
    workspaceId: string,
    runId: string,
  ): Promise<{ run: Record<string, unknown> }> {
    const run = await ownedRun(this.#database, actorId, workspaceId, runId);
    const toolCalls = await this.#database.query<Record<string, unknown>>(
      `SELECT tc.id, tc.tool_call_id AS toolCallId, tc.tool_name AS toolName, tc.state,
              tc.preflight_at AS preflightAt, tc.execution_entered_at AS executionEnteredAt,
              tc.finalized_at AS finalizedAt, tc.result_digest AS resultDigest,
              CASE WHEN tc.state = 'waiting_approval' OR tc.tool_name LIKE 'write%' OR tc.tool_name LIKE 'edit%' OR tc.tool_name LIKE 'delete%' THEN 1 ELSE 0 END AS approvalRequired
         FROM tool_call_record tc
         JOIN run_attempt ra ON ra.id = tc.run_attempt_id
        WHERE ra.run_id = ? ORDER BY tc.preflight_at, tc.id`,
      [runId],
    );
    const events = await this.#database.query<Record<string, unknown>>(
      `SELECT id AS eventId, workspace_id AS workspaceId, sequence, type, run_id AS runId,
              occurred_at AS occurredAt, payload
         FROM domain_event WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1000`,
      [workspaceId],
    );
    const initialEvents: Record<string, unknown>[] = events.reverse().map(
      (event): Record<string, unknown> => ({
        ...event,
        payload: typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload,
      }),
    );
    return {
      run: {
        ...run,
        toolCalls,
        events: initialEvents,
        permitEvents: initialEvents.filter((event) => event.type === "approval.permit_consumed"),
      },
    };
  }

  async listRuns(
    actorId: string,
    workspaceId: string,
  ): Promise<{ runs: Record<string, unknown>[] }> {
    const workspaces = await this.#database.query<{ kind: string; owner_id: string }>(
      "SELECT kind, owner_id FROM workspace WHERE id = ?",
      [workspaceId],
    );
    const workspace = workspaces[0];
    if (workspace === undefined) throw new ProblemError("not_found");
    if (workspace.kind === "personal") {
      if (workspace.owner_id !== actorId) throw new ProblemError("not_found");
    } else {
      await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    }
    return {
      runs: await this.#database.query<Record<string, unknown>>(
        `${RUN_SELECT} WHERE r.workspace_id = ? ORDER BY r.sequence DESC`,
        [workspaceId],
      ),
    };
  }

  async enqueue(
    actorId: string,
    workspaceId: string,
    runId: string,
    kind: "steer" | "follow_up",
    input: RunCommandInput,
    commandId: string,
  ) {
    const body = requiredText(input.body, "body");
    const operatorEpoch = epoch(input.operatorEpoch);
    const payloadDigest = digest(input.payloadDigest);
    const queuedInstruction = {
      id: this.#newId(),
      runId,
      kind: kind === "follow_up" ? "follow_up" : "steer",
      body,
      state: "queued",
      position: 1,
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response: { queuedInstruction },
        mutate: async (transaction) => {
          await ownedRun(transaction, actorId, workspaceId, runId);
          await assertOperator(transaction, workspaceId, operatorEpoch);
          await assertRunCommandAuthority(transaction, actorId, workspaceId);
          const position = await transaction.query<{ position: number }>(
            "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM queued_instruction WHERE run_id = ?",
            [runId],
          );
          queuedInstruction.position = position[0]?.position ?? 1;
          const sourceId = this.#newId();
          await transaction.execute(
            "INSERT INTO run_command (id, run_id, workspace_id, kind, payload, payload_digest, command_id, actor_id, operator_epoch, accepted_at, result_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              sourceId,
              runId,
              workspaceId,
              kind,
              JSON.stringify(input),
              payloadDigest,
              commandId,
              actorId,
              operatorEpoch,
              this.#now().toISOString(),
              queuedInstruction.id,
            ],
          );
          await transaction.execute(
            "INSERT INTO queued_instruction (id, run_id, source_command_id, kind, body, state, position, dequeued_at, persisted_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL)",
            [
              queuedInstruction.id,
              runId,
              sourceId,
              queuedInstruction.kind,
              body,
              queuedInstruction.position,
            ],
          );
        },
        events: [
          {
            type: `run.${kind}_queued`,
            schemaVersion: 1,
            occurredAt: this.#now().toISOString(),
            runId,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { queuedInstructionId: queuedInstruction.id },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      mapCommandError(error);
    }
  }

  /** Worker-only boundary: releases the next queued instruction after the current tool settles. */
  async consumeNextInstruction(
    actorId: string,
    workspaceId: string,
    runId: string,
    operatorEpoch: number,
  ) {
    epoch(operatorEpoch);
    return this.#database.write(async (transaction) => {
      await ownedRun(transaction, actorId, workspaceId, runId);
      await assertOperator(transaction, workspaceId, operatorEpoch);
      await assertRunCommandAuthority(transaction, actorId, workspaceId);
      const rows = await transaction.query<Record<string, unknown>>(
        "SELECT id, kind, body, position FROM queued_instruction WHERE run_id = ? AND state IN ('queued', 'modified') ORDER BY position ASC LIMIT 1",
        [runId],
      );
      const next = rows[0];
      if (next === undefined) return null;
      const now = this.#now().toISOString();
      await transaction.execute(
        "UPDATE queued_instruction SET state = 'released', dequeued_at = ?, persisted_at = ? WHERE id = ? AND state IN ('queued', 'modified')",
        [now, now, next.id],
      );
      const eventId = this.#newId();
      const payload = { queuedInstructionId: next.id, position: next.position, kind: next.kind };
      const payloadDigest = digest(
        `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
      );
      await transaction.execute(
        `INSERT INTO domain_event (id, workspace_id, sequence, schema_version, type, actor_id, run_id, occurred_at, visibility, payload_ref, payload_digest, payload) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_event WHERE workspace_id = ?), 1, 'run.queue_released', ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          workspaceId,
          workspaceId,
          actorId,
          runId,
          now,
          JSON.stringify({ kind: "workspace_members" }),
          `event:${eventId}`,
          payloadDigest,
          JSON.stringify(payload),
        ],
      );
      await transaction.execute(
        "INSERT INTO outbox_message (id, domain_event_id, destination, state, attempt_count, available_at, created_at) VALUES (?, ?, 'domain-events', 'pending', 0, ?, ?)",
        [this.#newId(), eventId, now, now],
      );
      return {
        id: String(next.id),
        kind: String(next.kind),
        body: String(next.body),
        position: Number(next.position),
        releasedAt: now,
      };
    });
  }

  async stop(
    actorId: string,
    workspaceId: string,
    runId: string,
    input: RunCommandInput,
    commandId: string,
  ) {
    if (input.confirmedStop !== true)
      throw new ProblemError("invalid_request", { detail: "confirmedStop must be true." });
    const operatorEpoch = epoch(input.operatorEpoch);
    const payloadDigest = digest(input.payloadDigest);
    const run = { id: runId, workspaceId, state: "stopping" };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response: { run, queuedInstructionsWithheld: true },
        mutate: async (transaction) => {
          await ownedRun(transaction, actorId, workspaceId, runId);
          await assertOperator(transaction, workspaceId, operatorEpoch);
          await assertRunCommandAuthority(transaction, actorId, workspaceId);
          const now = this.#now().toISOString();
          await transaction.execute(
            "UPDATE run SET state = 'stopping' WHERE id = ? AND state IN ('created', 'running', 'waiting_approval', 'needs_confirmation')",
            [runId],
          );
          await transaction.execute(
            "UPDATE queued_instruction SET state = 'withheld' WHERE run_id = ? AND state IN ('queued', 'modified')",
            [runId],
          );
          await transaction.execute(
            "INSERT INTO run_command (id, run_id, workspace_id, kind, payload, payload_digest, command_id, actor_id, operator_epoch, accepted_at, result_ref) VALUES (?, ?, ?, 'stop', ?, ?, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              runId,
              workspaceId,
              JSON.stringify(input),
              payloadDigest,
              commandId,
              actorId,
              operatorEpoch,
              now,
              runId,
            ],
          );
        },
        events: [
          {
            type: "run.stop_requested",
            schemaVersion: 1,
            occurredAt: this.#now().toISOString(),
            runId,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: { runId, state: "stopping" },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      mapCommandError(error);
    }
  }

  /** Worker acknowledgement after stop persistence, queue clearing and drain complete. */
  async settleStoppedRun(
    actorId: string,
    workspaceId: string,
    runId: string,
    operatorEpoch: number,
  ) {
    epoch(operatorEpoch);
    const payload = { runId, operatorEpoch, state: "cancelled" };
    const payloadDigest = digest(
      `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
    );
    const commandId = this.#newId();
    const response: { run: Record<string, unknown> } = {
      run: { id: runId, workspaceId, state: "cancelled" },
    };
    const now = this.#now().toISOString();
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          const current = await ownedRun(transaction, actorId, workspaceId, runId);
          await assertOperator(transaction, workspaceId, operatorEpoch);
          await assertRunCommandAuthority(transaction, actorId, workspaceId);
          if (current.state === "cancelled") return;
          if (current.state !== "stopping")
            throw new ProblemError("invalid_request", {
              detail: "Only a stopping Run can settle as cancelled.",
            });
          await transaction.execute(
            "UPDATE run SET state = 'cancelled', ended_at = ? WHERE id = ? AND state = 'stopping'",
            [now, runId],
          );
          await transaction.execute(
            "UPDATE run_attempt SET state = 'settled', settled_at = ? WHERE run_id = ? AND state IN ('assigned', 'dispatched', 'running')",
            [now, runId],
          );
          await transaction.execute(
            "UPDATE workspace_control SET active_run_id = NULL, active_run_epoch = 0, revision = revision + 1, updated_at = ? WHERE workspace_id = ?",
            [now, workspaceId],
          );
          response.run = { ...response.run, operatorEpoch, endedAt: now };
        },
        events: [
          {
            type: "run.stopped",
            schemaVersion: 1,
            occurredAt: now,
            runId,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload,
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      mapCommandError(error);
    }
  }

  async queueAction(
    actorId: string,
    workspaceId: string,
    runId: string,
    input: {
      queuedInstructionId: string;
      action: string;
      editedBody?: string;
      operatorEpoch: number;
      payloadDigest: string;
    },
    commandId: string,
  ) {
    if (!["retain", "modify", "delete", "release"].includes(input.action))
      throw new ProblemError("invalid_request");
    const operatorEpoch = epoch(input.operatorEpoch);
    const payloadDigest = digest(input.payloadDigest);
    const response = {
      queuedInstructionId: requiredText(input.queuedInstructionId, "queuedInstructionId"),
      action: input.action,
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response,
        mutate: async (transaction) => {
          await ownedRun(transaction, actorId, workspaceId, runId);
          await assertOperator(transaction, workspaceId, operatorEpoch);
          await assertRunCommandAuthority(transaction, actorId, workspaceId);
          const now = this.#now().toISOString();
          if (input.action === "modify")
            await transaction.execute(
              "UPDATE queued_instruction SET body = ?, state = 'modified' WHERE id = ? AND run_id = ? AND state IN ('queued', 'modified')",
              [requiredText(input.editedBody, "editedBody"), input.queuedInstructionId, runId],
            );
          if (input.action === "delete")
            await transaction.execute(
              "UPDATE queued_instruction SET state = 'deleted' WHERE id = ? AND run_id = ? AND state IN ('queued', 'modified')",
              [input.queuedInstructionId, runId],
            );
          if (input.action === "release")
            await transaction.execute(
              "UPDATE queued_instruction SET state = 'released', dequeued_at = ? WHERE id = ? AND run_id = ? AND state IN ('queued', 'modified')",
              [now, input.queuedInstructionId, runId],
            );
          await transaction.execute(
            "INSERT INTO run_command (id, run_id, workspace_id, kind, payload, payload_digest, command_id, actor_id, operator_epoch, accepted_at, result_ref) VALUES (?, ?, ?, 'queue_action', ?, ?, ?, ?, ?, ?, ?)",
            [
              this.#newId(),
              runId,
              workspaceId,
              JSON.stringify(input),
              payloadDigest,
              commandId,
              actorId,
              operatorEpoch,
              now,
              input.queuedInstructionId,
            ],
          );
        },
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      mapCommandError(error);
    }
  }

  async assessResult(
    actorId: string,
    workspaceId: string,
    runId: string,
    input: {
      result: string;
      reason?: string;
      evidenceExceptionReason?: string;
      payloadDigest: string;
    },
    commandId: string,
  ) {
    if (!["complete", "partial", "incomplete", "failed", "cancelled"].includes(input.result))
      throw new ProblemError("invalid_request");
    const payloadDigest = digest(input.payloadDigest);
    const assessment = {
      runId,
      result: input.result,
      reason: input.reason ?? null,
      assessedBy: actorId,
      assessedAt: this.#now().toISOString(),
    };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response: { assessment },
        mutate: async (transaction) => {
          await ownedRun(transaction, actorId, workspaceId, runId);
          await transaction.execute(
            `INSERT INTO completion_assessment (run_id, result, reason, assessed_by, assessed_at, evidence_exception_id) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(run_id) DO UPDATE SET result = excluded.result, reason = excluded.reason, assessed_by = excluded.assessed_by, assessed_at = excluded.assessed_at`,
            [runId, input.result, input.reason ?? null, actorId, assessment.assessedAt],
          );
        },
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      mapCommandError(error);
    }
  }
}

export interface RunFenceServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface StartRunRequest {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly operatorEpoch: number;
  readonly idempotencyKey: string;
  readonly commandId: string;
  readonly payloadDigest: string;
}

export interface TakeOverRequest {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly expectedOperatorEpoch: number;
  readonly reason: string;
}

export type StartRunResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly operatorEpoch: number;
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ProblemCode;
    };

export type TakeOverResult =
  | {
      readonly ok: true;
      readonly operatorEpoch: number;
    }
  | {
      readonly ok: false;
      readonly code: ProblemCode;
    };

interface WorkspaceFence {
  operatorEpoch: number;
  activeRunId: string | null;
}

function commandFailure(error: unknown): { readonly ok: false; readonly code: ProblemCode } {
  if (error instanceof ProblemError) return { ok: false, code: error.code };
  throw error;
}

/**
 * In-process start and takeover fences for the same invariants enforced by the
 * transactional RunsService: one active Run per workspace, operator epochs only
 * advance through an atomic compare-and-swap, and a retried start key replays
 * its first committed result.
 */
export class RunFenceService {
  readonly #newId: () => string;
  readonly #commands: CommandIdempotencyService;
  readonly #workspaces = new Map<string, WorkspaceFence>();

  constructor(options: RunFenceServiceOptions = {}) {
    this.#newId = options.newId ?? (() => uuidv7());
    this.#commands =
      options.now === undefined
        ? createCommandIdempotencyService()
        : createCommandIdempotencyService({ now: options.now });
  }

  async start(input: StartRunRequest): Promise<StartRunResult> {
    try {
      const workspaceId = requiredText(input.workspaceId, "workspaceId");
      requiredText(input.actorId, "actorId");
      const operatorEpoch = epoch(input.operatorEpoch);
      const payloadDigest = digest(input.payloadDigest);
      const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
      const commandId = requiredText(input.commandId, "commandId");
      const workspace = this.#workspace(workspaceId, operatorEpoch);

      const outcome = await this.#commands.execute<{ runId: string; operatorEpoch: number }>({
        idempotencyKey: `${workspaceId}:${idempotencyKey}`,
        commandId,
        payloadDigest,
        execute: async () => {
          if (workspace.operatorEpoch !== operatorEpoch) {
            throw new ProblemError("operator_changed");
          }
          if (workspace.activeRunId !== null) throw new ProblemError("task_active");
          const runId = this.#newId();
          workspace.activeRunId = runId;
          return { state: "succeeded", result: { runId, operatorEpoch } };
        },
      });
      if (!outcome.ok) return outcome;

      const result = outcome.receipt.result;
      if (result === undefined) throw new Error("The start receipt is missing its result.");
      return {
        ok: true,
        runId: result.runId,
        operatorEpoch: result.operatorEpoch,
        replayed: outcome.replayed,
      };
    } catch (error) {
      return commandFailure(error);
    }
  }

  async takeOver(input: TakeOverRequest): Promise<TakeOverResult> {
    try {
      const workspaceId = requiredText(input.workspaceId, "workspaceId");
      requiredText(input.actorId, "actorId");
      requiredText(input.reason, "reason");
      const expectedOperatorEpoch = epoch(input.expectedOperatorEpoch);
      const workspace = this.#workspaces.get(workspaceId);
      if (workspace === undefined) return { ok: false, code: "not_found" };
      if (workspace.operatorEpoch !== expectedOperatorEpoch) {
        return { ok: false, code: "operator_changed" };
      }
      workspace.operatorEpoch += 1;
      return { ok: true, operatorEpoch: workspace.operatorEpoch };
    } catch (error) {
      return commandFailure(error);
    }
  }

  #workspace(workspaceId: string, operatorEpoch: number): WorkspaceFence {
    const existing = this.#workspaces.get(workspaceId);
    if (existing !== undefined) return existing;
    const workspace: WorkspaceFence = { operatorEpoch, activeRunId: null };
    this.#workspaces.set(workspaceId, workspace);
    return workspace;
  }
}

export function createRunService(options: RunFenceServiceOptions = {}): RunFenceService {
  return new RunFenceService(options);
}
