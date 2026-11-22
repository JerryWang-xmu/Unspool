import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openDatabase } from "../../../../packages/persistence/src/database.js";
import {
  foundationMigrations,
  runMigrations,
} from "../../../../packages/persistence/src/migrations.js";
import { createObjectStore } from "../../../../packages/persistence/src/object-store.js";
import { createDefaultSecurityLabel } from "../../../../packages/security/src/default-label.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";

export interface PersonalRepositoryOptions {
  readonly dataDir: string;
}

export interface PersonalRepository {
  close(): Promise<void>;
  createTask(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  startConversation(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  appendRun(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  saveCheckpoint(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  saveArtifact(
    input: Record<string, unknown> & { bytes: Uint8Array },
  ): Promise<{ artifactVersionId: string; blobId: string; sha256: string; size: number }>;
  resumeTask(workspaceId: string): Promise<Record<string, unknown> | null>;
  listRecentTasks(options?: { limit?: number }): Promise<Record<string, unknown>[]>;
}

function digestOf(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new TypeError(`${field} is required`);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new TypeError(`${field} must be an integer`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function visibility(value: unknown): string {
  return value === "private"
    ? "owner_private"
    : requiredString(value ?? "invited_members", "visibility");
}

export async function openPersonalRepository(
  options: PersonalRepositoryOptions,
): Promise<PersonalRepository> {
  const dataDir = options.dataDir;
  await mkdir(dataDir, { recursive: true });
  const database = await openDatabase({ filename: join(dataDir, "unspool.sqlite") });
  await runMigrations(database, foundationMigrations);
  const objects = createObjectStore({ directory: dataDir });

  const repository: PersonalRepository = {
    close: async () => database.close(),

    async createTask(input) {
      const id = optionalString(input.id) ?? uuidv7();
      const kind = requiredString(input.kind, "kind");
      const status = requiredString(input.status, "status");
      const workspace = {
        id,
        kind,
        teamId: input.teamId ?? null,
        ownerId: requiredString(input.ownerId, "ownerId"),
        runnerId: requiredString(input.runnerId, "runnerId"),
        name: requiredString(input.name, "name"),
        goal: requiredString(input.goal, "goal"),
        completionCriteria: requiredString(input.completionCriteria, "completionCriteria"),
        status,
        visibility: visibility(input.visibility),
        agentConfigSnapshot: input.agentConfigSnapshot ?? {},
        federationMode: requiredString(input.federationMode, "federationMode"),
        revision: requiredNumber(input.revision, "revision"),
        createdAt: requiredString(input.createdAt, "createdAt"),
        archivedAt: optionalString(input.archivedAt),
      };
      const ownerId = requiredString(input.ownerId, "ownerId");
      const runnerId = requiredString(input.runnerId, "runnerId");
      const createdAt = requiredString(input.createdAt, "createdAt");
      await database.execute(
        "INSERT OR IGNORE INTO user (id, display_name, status, auth_version, created_at) VALUES (?, ?, ?, ?, ?)",
        [ownerId, "Personal User", "active", 1, createdAt],
      );
      await database.execute(
        "INSERT OR IGNORE INTO runner (id, team_id, name, purpose, status, version, capabilities, policy_revision, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [runnerId, null, "Local Runner", "personal", "available", "0.1.0", "[]", 0, createdAt],
      );
      await database.execute(
        `INSERT INTO workspace (
          id, kind, team_id, owner_id, runner_id, name, goal, completion_criteria,
          status, visibility, agent_config_snapshot, federation_mode, revision, created_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workspace.id,
          workspace.kind,
          workspace.teamId,
          workspace.ownerId,
          workspace.runnerId,
          workspace.name,
          workspace.goal,
          workspace.completionCriteria,
          workspace.status,
          workspace.visibility,
          json(workspace.agentConfigSnapshot),
          workspace.federationMode,
          workspace.revision,
          workspace.createdAt,
          workspace.archivedAt,
        ],
      );
      return workspace;
    },

    async startConversation(input) {
      const conversation = {
        id: optionalString(input.id) ?? uuidv7(),
        workspaceId: requiredString(input.workspaceId, "workspaceId"),
        piSessionRef: requiredString(input.piSessionRef, "piSessionRef"),
        sessionFormatVersion: requiredNumber(input.sessionFormatVersion, "sessionFormatVersion"),
        continuationOfId: optionalString(input.continuationOfId),
        createdAt: requiredString(input.createdAt, "createdAt"),
      };
      await database.execute(
        "INSERT INTO agent_conversation (id, workspace_id, pi_session_ref, session_format_version, continuation_of_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
          conversation.id,
          conversation.workspaceId,
          conversation.piSessionRef,
          conversation.sessionFormatVersion,
          conversation.continuationOfId,
          conversation.createdAt,
        ],
      );
      return conversation;
    },

    async appendRun(input) {
      const run = {
        id: optionalString(input.id) ?? uuidv7(),
        workspaceId: requiredString(input.workspaceId, "workspaceId"),
        conversationId: requiredString(input.conversationId, "conversationId"),
        sequence: requiredNumber(input.sequence, "sequence"),
        state: requiredString(input.state, "state"),
        operatorEpoch: requiredNumber(input.operatorEpoch, "operatorEpoch"),
        runnerId: requiredString(input.runnerId, "runnerId"),
        contextSnapshotId: requiredString(input.contextSnapshotId, "contextSnapshotId"),
        startedBy: requiredString(input.startedBy, "startedBy"),
        startedAt: requiredString(input.startedAt, "startedAt"),
        endedAt: optionalString(input.endedAt),
        lastKnownCheckpoint: optionalString(input.lastKnownCheckpoint),
      };
      await database.write(async (transaction) => {
        await transaction.execute(
          "INSERT INTO task_context_snapshot (id, run_id, context_version_ids, rendered_digest, created_at) VALUES (?, ?, ?, ?, ?)",
          [run.contextSnapshotId, run.id, "[]", digestOf(run.contextSnapshotId), run.startedAt],
        );
        await transaction.execute(
          `INSERT INTO run (
            id, workspace_id, conversation_id, sequence, state, operator_epoch,
            runner_id, context_snapshot_id, started_by, started_at, ended_at, last_known_checkpoint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            run.id,
            run.workspaceId,
            run.conversationId,
            run.sequence,
            run.state,
            run.operatorEpoch,
            run.runnerId,
            run.contextSnapshotId,
            run.startedBy,
            run.startedAt,
            run.endedAt,
            run.lastKnownCheckpoint,
          ],
        );
        const eventId = uuidv7();
        await transaction.execute(
          `INSERT INTO domain_event (
            id, workspace_id, sequence, schema_version, type, actor_id, run_id,
            occurred_at, visibility, payload_ref, payload_digest, payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            run.workspaceId,
            run.sequence,
            1,
            `run.${run.state}`,
            run.startedBy,
            run.id,
            run.startedAt,
            json({ kind: "workspace_members" }),
            `run:${run.id}`,
            digestOf(JSON.stringify(run)),
            json(run),
          ],
        );
        await transaction.execute(
          "INSERT INTO outbox_message (id, domain_event_id, destination, state, attempt_count, available_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [uuidv7(), eventId, "domain-events", "pending", 0, run.startedAt, run.startedAt],
        );
      });
      return run;
    },

    async saveCheckpoint(input) {
      const checkpoint = {
        id: optionalString(input.id) ?? uuidv7(),
        conversationId: requiredString(input.conversationId, "conversationId"),
        runId: optionalString(input.runId),
        piLeafId: requiredString(input.piLeafId, "piLeafId"),
        lastPersistedEntryId: requiredString(input.lastPersistedEntryId, "lastPersistedEntryId"),
        lastProjectedEventId: requiredString(input.lastProjectedEventId, "lastProjectedEventId"),
        createdAt: requiredString(input.createdAt, "createdAt"),
      };
      await database.execute(
        "INSERT INTO session_checkpoint (id, conversation_id, run_id, pi_leaf_id, last_persisted_entry_id, last_projected_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          checkpoint.id,
          checkpoint.conversationId,
          checkpoint.runId,
          checkpoint.piLeafId,
          checkpoint.lastPersistedEntryId,
          checkpoint.lastProjectedEventId,
          checkpoint.createdAt,
        ],
      );
      return checkpoint;
    },

    async saveArtifact(input) {
      const bytes = input.bytes;
      const sha256 = digestOf(bytes);
      const stored = await objects.put(bytes, {
        mediaType: optionalString(input.mediaType) ?? "application/octet-stream",
      });
      const blobId = uuidv7();
      const artifactVersionId = uuidv7();
      const createdAt = requiredString(input.createdAt, "createdAt");
      await database.write(async (transaction) => {
        await transaction.execute(
          "INSERT INTO blob_object (id, storage_key, sha256, size, media_type, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            blobId,
            stored.storageKey,
            sha256,
            stored.size,
            stored.mediaType ?? "application/octet-stream",
            "available",
            createdAt,
          ],
        );
        const defaultLabel = createDefaultSecurityLabel({
          id: "stable-default",
          purpose: "personal_task",
        });
        await transaction.execute(
          "INSERT OR IGNORE INTO security_label (id, version, purpose_rules, member_rules, model_recipient_rules, target_domain_rules, public_visibility, cache_and_retention, untrusted_content, review_history) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            defaultLabel.id,
            defaultLabel.version,
            json(defaultLabel.purposeRules),
            json(defaultLabel.memberRules),
            json(defaultLabel.modelRecipientRules),
            json(defaultLabel.targetDomainRules),
            defaultLabel.publicVisibility ? 1 : 0,
            json(defaultLabel.cacheAndRetention),
            defaultLabel.untrustedContent ? 1 : 0,
            json(defaultLabel.reviewHistory),
          ],
        );
        await transaction.execute(
          `INSERT INTO artifact_version (
            id, artifact_id, version, blob_id, kind, origin_type, origin_id, run_id,
            attribution, security_label_id, source_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            artifactVersionId,
            requiredString(input.artifactId, "artifactId"),
            requiredNumber(input.version, "version"),
            blobId,
            requiredString(input.kind, "kind"),
            requiredString(input.originType, "originType"),
            requiredString(input.originId, "originId"),
            optionalString(input.runId),
            json({
              actorId: requiredString(input.ownerId ?? "user", "ownerId"),
              displayNameAtTime: "Personal User",
              rolesAtTime: ["owner"],
              occurredAt: createdAt,
            }),
            defaultLabel.id,
            requiredString(input.sourceSummary, "sourceSummary"),
          ],
        );
        await transaction.execute(
          "INSERT INTO artifact_metadata (artifact_version_id, name, media_type, created_at) VALUES (?, ?, ?, ?)",
          [
            artifactVersionId,
            requiredString(input.name, "name"),
            requiredString(input.mediaType, "mediaType"),
            createdAt,
          ],
        );
      });
      return { artifactVersionId, blobId, sha256, size: stored.size };
    },

    async resumeTask(workspaceId) {
      const workspace = await database.query<Record<string, unknown>>(
        `SELECT id, kind, team_id AS teamId, owner_id AS ownerId, runner_id AS runnerId, name, goal,
                completion_criteria AS completionCriteria, status, visibility,
                agent_config_snapshot AS agentConfigSnapshot, federation_mode AS federationMode,
                revision, created_at AS createdAt, archived_at AS archivedAt
         FROM workspace WHERE id = ?`,
        [workspaceId],
      );
      const workspaceRow = workspace[0];
      if (workspaceRow === undefined) return null;
      const conversation = (
        await database.query<Record<string, unknown>>(
          `SELECT id, workspace_id AS workspaceId, pi_session_ref AS piSessionRef,
                session_format_version AS sessionFormatVersion, continuation_of_id AS continuationOfId,
                created_at AS createdAt
         FROM agent_conversation WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1`,
          [workspaceId],
        )
      )[0];
      if (conversation === undefined)
        throw new Error(`No conversation found for workspace ${workspaceId}`);
      const run = (
        await database.query<Record<string, unknown>>(
          `SELECT id, workspace_id AS workspaceId, conversation_id AS conversationId, sequence, state,
                operator_epoch AS operatorEpoch, runner_id AS runnerId, context_snapshot_id AS contextSnapshotId,
                started_by AS startedBy, started_at AS startedAt, ended_at AS endedAt,
                last_known_checkpoint AS lastKnownCheckpoint
         FROM run WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1`,
          [workspaceId],
        )
      )[0];
      if (run === undefined) throw new Error(`No run found for workspace ${workspaceId}`);
      const checkpoint = (
        await database.query<Record<string, unknown>>(
          `SELECT id, conversation_id AS conversationId, run_id AS runId, pi_leaf_id AS piLeafId,
                last_persisted_entry_id AS lastPersistedEntryId,
                last_projected_event_id AS lastProjectedEventId, created_at AS createdAt
         FROM session_checkpoint WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`,
          [conversation.id],
        )
      )[0];
      if (checkpoint === undefined)
        throw new Error(`No checkpoint found for conversation ${conversation.id}`);
      const artifacts = await database.query<Record<string, unknown>>(
        `SELECT av.id AS artifactVersionId, av.artifact_id AS artifactId, av.version, am.name, am.media_type AS mediaType,
                bo.sha256, bo.size, bo.state AS blobState, bo.storage_key AS storageKey
         FROM artifact_version av
         JOIN artifact_metadata am ON am.artifact_version_id = av.id
         JOIN blob_object bo ON bo.id = av.blob_id
         WHERE av.run_id = ? OR av.origin_id = ? OR av.origin_id = ?
         ORDER BY av.artifact_id, av.version`,
        [run.id, run.id, conversation.workspaceId],
      );
      const enriched = await Promise.all(
        artifacts.map(async (artifact) => {
          let status = "ok";
          let bytes: Uint8Array = new Uint8Array();
          try {
            bytes = await objects.get(artifact.sha256 as string);
          } catch {
            status = artifact.blobState === "missing" ? "missing" : "digest_mismatch";
          }
          return { ...artifact, status, bytes };
        }),
      );
      return { workspace: workspaceRow, conversation, run, checkpoint, artifacts: enriched };
    },

    async listRecentTasks(options = {}) {
      const limit = options.limit ?? 50;
      const workspaces = await database.query<Record<string, unknown>>(
        "SELECT id, name FROM workspace ORDER BY created_at DESC",
      );
      const recent: Record<string, unknown>[] = [];
      for (const workspace of workspaces) {
        const run = (
          await database.query<Record<string, unknown>>(
            "SELECT id, started_at FROM run WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1",
            [workspace.id],
          )
        )[0];
        const checkpoint = (
          await database.query<Record<string, unknown>>(
            "SELECT id, created_at FROM session_checkpoint WHERE conversation_id = (SELECT id FROM agent_conversation WHERE workspace_id = ?) ORDER BY created_at DESC LIMIT 1",
            [workspace.id],
          )
        )[0];
        const latest = (
          await database.query<Record<string, unknown>>(
            "SELECT created_at FROM artifact_metadata WHERE artifact_version_id IN (SELECT id FROM artifact_version WHERE run_id = ? OR origin_id = ?) ORDER BY created_at DESC LIMIT 1",
            [run?.id ?? null, workspace.id],
          )
        )[0];
        const updatedAt =
          [checkpoint?.created_at, latest?.created_at, run?.started_at]
            .filter((value): value is string => typeof value === "string")
            .sort()
            .at(-1) ?? "";
        recent.push({
          workspaceId: workspace.id,
          name: workspace.name,
          latestRunId: run?.id ?? null,
          latestCheckpointId: checkpoint?.id ?? null,
          updatedAt,
        });
      }
      recent.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return recent.slice(0, limit);
    },
  };

  return repository;
}
