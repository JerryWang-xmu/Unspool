import { createShareConversion } from "../../../../packages/domain/src/share-conversion.js";
import {
  createSharePreview,
  isSharePreviewExpired,
  type SharePreview,
} from "../../../../packages/domain/src/share-preview.js";
import type {
  SqliteDatabase,
  SqliteTransaction,
} from "../../../../packages/persistence/src/database.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";

export interface SharingServiceOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly previewTtlMs?: number;
}

export interface ShareMemberInput {
  readonly userId: string;
  readonly role: "owner" | "operator" | "contributor" | "observer";
  readonly canApprove?: boolean;
  readonly canReview?: boolean;
}

export interface SharePreviewCommandInput {
  readonly selectedRecordIds: readonly string[];
  readonly excludedCategories?: readonly string[];
  readonly payloadDigest: string;
}

export interface ShareConversionCommandInput {
  readonly sharePreviewId: string;
  readonly teamId: string;
  readonly members: readonly ShareMemberInput[];
  readonly payloadDigest: string;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new ProblemError("invalid_request");
  return value;
}

function selection(value: readonly string[]): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((id) => typeof id !== "string" || id.trim().length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new ProblemError("invalid_request", {
      detail: "selectedRecordIds must be an explicit, non-empty, duplicate-free selection.",
    });
  }
  return [...value];
}

async function personalWorkspace(
  transaction: SqliteTransaction,
  actorId: string,
  workspaceId: string,
) {
  const rows = await transaction.query<Record<string, unknown>>(
    "SELECT * FROM workspace WHERE id = ? AND owner_id = ? AND kind = 'personal'",
    [workspaceId, actorId],
  );
  const workspace = rows[0];
  if (workspace === undefined) throw new ProblemError("not_found");
  return workspace;
}

async function selectedRecords(
  transaction: SqliteTransaction,
  workspaceId: string,
  selectedRecordIds: readonly string[],
) {
  const contexts = await transaction.query<Record<string, unknown>>(
    `SELECT cv.*, ci.workspace_id, ci.kind AS item_kind FROM context_version cv
     JOIN context_item ci ON ci.id = cv.context_item_id WHERE ci.workspace_id = ?`,
    [workspaceId],
  );
  const artifacts = await transaction.query<Record<string, unknown>>(
    `SELECT av.*, am.name, am.media_type, am.created_at AS metadata_created_at FROM artifact_version av
     JOIN artifact_metadata am ON am.artifact_version_id = av.id
     LEFT JOIN run r ON r.id = av.run_id
     WHERE av.origin_id = ? OR r.workspace_id = ?`,
    [workspaceId, workspaceId],
  );
  const selected = new Set(selectedRecordIds);
  const selectedContexts = contexts.filter((row) => selected.has(String(row.id)));
  const selectedArtifacts = artifacts.filter((row) => selected.has(String(row.id)));
  if (selectedContexts.length + selectedArtifacts.length !== selected.size) {
    throw new ProblemError("invalid_request", {
      detail:
        "Every selected record must belong to the source workspace and use a supported version id.",
    });
  }
  return { contexts: selectedContexts, artifacts: selectedArtifacts };
}

function attribution(actorId: string, now: string, original: unknown) {
  let originalAttribution = original;
  if (typeof original === "string") {
    try {
      originalAttribution = JSON.parse(original);
    } catch {
      originalAttribution = undefined;
    }
  }
  return JSON.stringify({
    actorId,
    displayNameAtTime: "Personal Owner",
    rolesAtTime: ["owner"],
    occurredAt: now,
    ...(originalAttribution === undefined ? {} : { originalAttribution }),
  });
}

export class SharingService {
  readonly #database: SqliteDatabase;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #previewTtlMs: number;

  constructor(options: SharingServiceOptions) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
    this.#previewTtlMs = options.previewTtlMs ?? 15 * 60 * 1_000;
  }

  async createPreview(
    actorId: string,
    workspaceId: string,
    input: SharePreviewCommandInput,
    commandId: string,
  ) {
    const selectedRecordIds = selection(input.selectedRecordIds);
    const payloadDigest = digest(input.payloadDigest);
    const now = this.#now();
    const preview = createSharePreview({
      id: this.#newId(),
      sourceWorkspaceId: workspaceId,
      selectedRecordIds,
      ...(input.excludedCategories === undefined
        ? {}
        : { excludedCategories: input.excludedCategories }),
      createdBy: actorId,
      expiresAt: new Date(now.getTime() + this.#previewTtlMs).toISOString(),
    });
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest,
        response: { sharePreview: preview },
        mutate: async (transaction) => {
          await personalWorkspace(transaction, actorId, workspaceId);
          await selectedRecords(transaction, workspaceId, selectedRecordIds);
          await transaction.execute(
            "INSERT INTO share_preview (id, source_workspace_id, selected_record_ids, excluded_categories, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
              preview.id,
              workspaceId,
              JSON.stringify(preview.selectedRecordIds),
              JSON.stringify(preview.excludedCategories),
              actorId,
              preview.expiresAt,
            ],
          );
        },
        events: [
          {
            type: "share.preview_created",
            schemaVersion: 1,
            occurredAt: now.toISOString(),
            visibility: { kind: "owner_private" },
            payloadDigest,
            payload: { previewId: preview.id, selectedCount: selectedRecordIds.length },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof RangeError) throw new ProblemError("invalid_request");
      if (error instanceof CommandRevisionConflictError)
        throw new ProblemError("revision_conflict");
      throw error;
    }
  }

  async convert(
    actorId: string,
    sourceWorkspaceId: string,
    input: ShareConversionCommandInput,
    commandId: string,
  ) {
    const payloadDigest = digest(input.payloadDigest);
    if (!Array.isArray(input.members) || input.members.length === 0)
      throw new ProblemError("invalid_request", {
        detail: "At least one initial shared member is required.",
      });
    const targetWorkspaceId = this.#newId();
    const now = this.#now().toISOString();
    const workspace: Record<string, unknown> = {
      id: targetWorkspaceId,
      kind: "shared",
      teamId: input.teamId,
      revision: 1,
      status: "active",
    };
    const eventPayload = { sourceWorkspaceId, targetWorkspaceId, selectedCount: 0 };
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId: targetWorkspaceId,
        commandId,
        payloadDigest,
        response: { workspace },
        mutate: async (transaction) => {
          const source = await personalWorkspace(transaction, actorId, sourceWorkspaceId);
          const previews = await transaction.query<Record<string, unknown>>(
            "SELECT * FROM share_preview WHERE id = ? AND source_workspace_id = ? AND created_by = ?",
            [input.sharePreviewId, sourceWorkspaceId, actorId],
          );
          const previewRow = previews[0];
          if (previewRow === undefined) throw new ProblemError("not_found");
          const preview: SharePreview = {
            id: String(previewRow.id),
            sourceWorkspaceId,
            selectedRecordIds: JSON.parse(String(previewRow.selected_record_ids)),
            excludedCategories: JSON.parse(String(previewRow.excluded_categories)),
            createdBy: actorId,
            expiresAt: String(previewRow.expires_at),
          };
          if (isSharePreviewExpired(preview, now))
            throw new ProblemError("approval_invalid", { detail: "Share preview has expired." });
          eventPayload.selectedCount = preview.selectedRecordIds.length;
          const records = await selectedRecords(
            transaction,
            sourceWorkspaceId,
            preview.selectedRecordIds,
          );
          const activeRuns = await transaction.query(
            "SELECT id FROM run WHERE workspace_id = ? AND state IN ('created', 'running', 'waiting_approval', 'stopping', 'needs_confirmation')",
            [sourceWorkspaceId],
          );
          if (activeRuns.length > 0) throw new ProblemError("task_active");
          const teams = await transaction.query("SELECT id FROM team WHERE id = ?", [input.teamId]);
          if (teams.length === 0) throw new ProblemError("not_found");
          const memberships = await transaction.query<{
            team_roles: string;
            status: string;
            expires_at: string | null;
          }>(
            "SELECT team_roles, status, expires_at FROM membership WHERE team_id = ? AND user_id = ?",
            [input.teamId, actorId],
          );
          const membership = memberships[0];
          const roles =
            membership === undefined ? [] : (JSON.parse(membership.team_roles) as string[]);
          if (
            membership === undefined ||
            membership.status !== "active" ||
            (membership.expires_at !== null &&
              Date.parse(membership.expires_at) <= Date.parse(now)) ||
            !roles.includes("administrator")
          ) {
            throw new ProblemError("permission_denied");
          }
          const stopped = await transaction.query<{ stopped_at: string | null }>(
            "SELECT MAX(ended_at) AS stopped_at FROM run WHERE workspace_id = ?",
            [sourceWorkspaceId],
          );
          const conversion = createShareConversion({
            id: this.#newId(),
            sourceWorkspaceId,
            targetWorkspaceId,
            selectedRecordIds: preview.selectedRecordIds,
            sourceRunStoppedAt: stopped[0]?.stopped_at ?? now,
            createdBy: actorId,
            createdAt: now,
          });
          const snapshot = JSON.parse(String(source.agent_config_snapshot)) as Record<
            string,
            unknown
          >;
          snapshot.pinned = false;
          Object.assign(workspace, {
            ownerId: actorId,
            runnerId: source.runner_id,
            name: `${String(source.name)} (shared)`.slice(0, 50),
            goal: source.goal,
            completionCriteria: source.completion_criteria,
            visibility: "invited_members",
            agentConfigSnapshot: snapshot,
            federationMode: "disabled",
            createdAt: now,
            archivedAt: null,
            currentOperator: { operatorId: actorId, operatorEpoch: 1 },
          });
          await transaction.execute(
            `INSERT INTO workspace (id, kind, team_id, owner_id, runner_id, name, goal, completion_criteria, status, visibility, agent_config_snapshot, federation_mode, revision, created_at, archived_at) VALUES (?, 'shared', ?, ?, ?, ?, ?, ?, 'active', 'invited_members', ?, 'disabled', 1, ?, NULL)`,
            [
              targetWorkspaceId,
              input.teamId,
              actorId,
              source.runner_id,
              workspace.name,
              source.goal,
              source.completion_criteria,
              JSON.stringify(snapshot),
              now,
            ],
          );
          await transaction.execute(
            "INSERT INTO workspace_control (workspace_id, operator_id, operator_epoch, active_run_id, active_run_epoch, revision, updated_at) VALUES (?, ?, 1, NULL, 0, 1, ?)",
            [targetWorkspaceId, actorId, now],
          );
          await transaction.execute(
            "INSERT INTO workspace_member (workspace_id, user_id, role, can_approve, can_review, joined_at, left_at) VALUES (?, ?, 'owner', 1, 1, ?, NULL)",
            [targetWorkspaceId, actorId, now],
          );
          const seenMembers = new Set([actorId]);
          for (const member of input.members) {
            if (
              seenMembers.has(member.userId) ||
              !["owner", "operator", "contributor", "observer"].includes(member.role)
            )
              throw new ProblemError("invalid_request");
            seenMembers.add(member.userId);
            await transaction.execute(
              "INSERT OR IGNORE INTO user (id, display_name, status, auth_version, created_at) VALUES (?, ?, 'active', 1, ?)",
              [member.userId, "Shared Member", now],
            );
            await transaction.execute(
              "INSERT INTO workspace_member (workspace_id, user_id, role, can_approve, can_review, joined_at, left_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
              [
                targetWorkspaceId,
                member.userId,
                member.role,
                member.canApprove === true ? 1 : 0,
                member.canReview === true ? 1 : 0,
                now,
              ],
            );
          }
          const groups = new Map<string, Record<string, unknown>[]>();
          for (const row of records.contexts) {
            const key = String(row.context_item_id);
            groups.set(key, [...(groups.get(key) ?? []), row]);
          }
          for (const versions of groups.values()) {
            versions.sort((left, right) => Number(left.version) - Number(right.version));
            const itemId = this.#newId();
            const versionIds = versions.map(() => this.#newId());
            const first = versions[0];
            if (first === undefined) continue;
            const latestVersionId = versionIds.at(-1);
            await transaction.execute(
              "INSERT INTO context_item (id, workspace_id, kind, current_version_id, created_by, created_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
              [itemId, targetWorkspaceId, first.item_kind, latestVersionId, actorId, now],
            );
            for (const [index, version] of versions.entries()) {
              await transaction.execute(
                `INSERT INTO context_version (id, context_item_id, version, title, body, source_refs, member_visibility, agent_exposure, attribution, supersedes_id) VALUES (?, ?, ?, ?, ?, ?, 'members', 'not_provided', ?, ?)`,
                [
                  versionIds[index],
                  itemId,
                  version.version,
                  version.title,
                  version.body,
                  version.source_refs,
                  attribution(actorId, now, version.attribution),
                  index === 0 ? null : versionIds[index - 1],
                ],
              );
            }
          }
          for (const artifact of records.artifacts) {
            const versionId = this.#newId();
            await transaction.execute(
              `INSERT INTO artifact_version (id, artifact_id, version, blob_id, kind, origin_type, origin_id, run_id, attribution, security_label_id, source_summary) VALUES (?, ?, 1, ?, ?, 'workspace', ?, NULL, ?, ?, ?)`,
              [
                versionId,
                this.#newId(),
                artifact.blob_id,
                artifact.kind,
                targetWorkspaceId,
                attribution(actorId, now, artifact.attribution),
                artifact.security_label_id,
                artifact.source_summary,
              ],
            );
            await transaction.execute(
              "INSERT INTO artifact_metadata (artifact_version_id, name, media_type, created_at) VALUES (?, ?, ?, ?)",
              [versionId, artifact.name, artifact.media_type, now],
            );
          }
          const conversations = await transaction.query<{ id: string }>(
            "SELECT id FROM agent_conversation WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1",
            [sourceWorkspaceId],
          );
          const continuationOfId = conversations[0]?.id;
          await transaction.execute(
            "INSERT INTO agent_conversation (id, workspace_id, pi_session_ref, session_format_version, continuation_of_id, created_at) VALUES (?, ?, ?, 1, ?, ?)",
            [
              this.#newId(),
              targetWorkspaceId,
              `sessions/${this.#newId()}.jsonl`,
              continuationOfId ?? null,
              now,
            ],
          );
          await transaction.execute(
            "INSERT INTO share_conversion (id, source_workspace_id, target_workspace_id, selected_record_ids, source_run_stopped_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              conversion.id,
              sourceWorkspaceId,
              targetWorkspaceId,
              JSON.stringify(conversion.selectedRecordIds),
              conversion.sourceRunStoppedAt,
              actorId,
              now,
            ],
          );
        },
        events: [
          {
            type: "workspace.shared_from_personal",
            schemaVersion: 1,
            occurredAt: now,
            visibility: { kind: "workspace_members" },
            payloadDigest,
            payload: eventPayload,
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof RangeError) throw new ProblemError("invalid_request");
      if (error instanceof CommandRevisionConflictError)
        throw new ProblemError("revision_conflict");
      throw error;
    }
  }
}

export function createSharingService(options: SharingServiceOptions): SharingService {
  return new SharingService(options);
}
