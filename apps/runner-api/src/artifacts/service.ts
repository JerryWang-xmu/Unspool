import { createHash } from "node:crypto";
import { canonicalizeJson, sha256Digest } from "../../../../packages/domain/src/action-proposal.js";
import { DEFAULT_ARTIFACT_UPLOAD_LIMIT_BYTES } from "../../../../packages/domain/src/artifact-version.js";
import type {
  SqliteDatabase,
  SqliteTransaction,
} from "../../../../packages/persistence/src/database.js";
import {
  createObjectStore,
  type ObjectStore,
} from "../../../../packages/persistence/src/object-store.js";
import {
  CommandRevisionConflictError,
  commitCommandUnitOfWork,
} from "../../../../packages/persistence/src/unit-of-work.js";
import { createDefaultSecurityLabel } from "../../../../packages/security/src/default-label.js";
import { uuidv7 } from "../../../../packages/security/src/uuid.js";
import { ProblemError } from "../errors/problem.js";
import { assertCanContribute, loadWorkspaceAccess } from "../workspaces/service.js";

export interface ArtifactMetadataInput {
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly kind: "reference";
  readonly sourceSummary: string;
  readonly runId?: string;
}

export interface ArtifactServiceOptions {
  readonly database: SqliteDatabase;
  readonly dataDir: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly maxUploadBytes?: number;
  readonly objects?: ObjectStore;
}

export interface ArtifactUploadResult {
  readonly response: { artifact: Record<string, unknown> };
  readonly replayed: boolean;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ProblemError("invalid_request", { detail: `${field} is required.` });
  return value;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertMetadata(
  metadata: ArtifactMetadataInput,
  bytes: Uint8Array,
  maxUploadBytes: number,
): void {
  requiredText(metadata.name, "name");
  requiredText(metadata.mediaType, "mediaType");
  requiredText(metadata.sourceSummary, "sourceSummary");
  if (metadata.kind !== "reference")
    throw new ProblemError("invalid_request", {
      detail: "Only reference artifacts may be uploaded through this endpoint.",
    });
  if (
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size !== bytes.byteLength
  )
    throw new ProblemError("invalid_request", {
      detail: "Artifact size does not match its content.",
    });
  if (bytes.byteLength > maxUploadBytes)
    throw new ProblemError("budget_exhausted", {
      detail: "Artifact exceeds the configured upload limit.",
    });
  if (metadata.sha256 !== digestBytes(bytes))
    throw new ProblemError("invalid_request", {
      detail: "Artifact SHA-256 does not match its content.",
    });
  // biome-ignore lint/suspicious/noControlCharactersInRegex: This validator intentionally rejects control characters.
  if (/^image\/svg|[\r\n\u0000]/.test(metadata.mediaType))
    throw new ProblemError("invalid_request");
}

async function assertWorkspace(
  transaction: SqliteTransaction,
  actorId: string,
  workspaceId: string,
  write = false,
): Promise<void> {
  const rows = await transaction.query<{ kind: string; owner_id: string }>(
    "SELECT kind, owner_id FROM workspace WHERE id = ?",
    [workspaceId],
  );
  const workspace = rows[0];
  if (workspace === undefined) throw new ProblemError("not_found");
  if (workspace.kind === "personal") {
    if (workspace.owner_id !== actorId) throw new ProblemError("not_found");
    return;
  }
  const access = await loadWorkspaceAccess(transaction, actorId, workspaceId);
  if (write) assertCanContribute(access);
}

const ARTIFACT_SELECT = `
  SELECT av.id AS artifactVersionId, av.artifact_id AS artifactId, av.version, av.blob_id AS blobId,
         av.kind, av.origin_type AS originType, av.origin_id AS originId, av.run_id AS runId,
         av.attribution, av.security_label_id AS securityLabelId, av.source_summary AS sourceSummary,
         am.name, am.media_type AS mediaType, am.created_at AS createdAt,
         bo.sha256, bo.size, bo.storage_key AS storageKey
  FROM artifact_version av
  JOIN artifact_metadata am ON am.artifact_version_id = av.id
  JOIN blob_object bo ON bo.id = av.blob_id
`;

export class ArtifactService {
  readonly #database: SqliteDatabase;
  readonly #objects: ObjectStore;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly maxUploadBytes: number;

  constructor(options: ArtifactServiceOptions) {
    this.#database = options.database;
    this.#objects = options.objects ?? createObjectStore({ directory: options.dataDir });
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => uuidv7());
    this.maxUploadBytes = options.maxUploadBytes ?? DEFAULT_ARTIFACT_UPLOAD_LIMIT_BYTES;
  }

  async upload(
    actorId: string,
    workspaceId: string,
    metadata: ArtifactMetadataInput,
    bytes: Uint8Array,
    commandId: string,
    artifactId = this.#newId(),
  ): Promise<ArtifactUploadResult> {
    assertMetadata(metadata, bytes, this.maxUploadBytes);
    const stored = await this.#objects.put(bytes, { mediaType: metadata.mediaType });
    const now = this.#now().toISOString();
    const artifactVersionId = this.#newId();
    const artifact: Record<string, unknown> = {
      id: artifactId,
      artifactId,
      artifactVersionId,
      version: 1,
      name: metadata.name,
      mediaType: metadata.mediaType,
      size: stored.size,
      sha256: stored.sha256,
      kind: metadata.kind,
      sourceSummary: metadata.sourceSummary,
      runId: metadata.runId ?? null,
      createdAt: now,
    };
    const commandDigest = sha256Digest(
      canonicalizeJson({ metadata: { ...metadata }, contentSha256: stored.sha256 }),
    );
    try {
      const result = await commitCommandUnitOfWork(this.#database, {
        actorId,
        workspaceId,
        commandId,
        payloadDigest: commandDigest,
        response: { artifact },
        mutate: async (transaction) => {
          await assertWorkspace(transaction, actorId, workspaceId, true);
          if (metadata.runId !== undefined) {
            const runs = await transaction.query(
              "SELECT id FROM run WHERE id = ? AND workspace_id = ?",
              [metadata.runId, workspaceId],
            );
            if (runs.length === 0)
              throw new ProblemError("invalid_request", {
                detail: "runId does not belong to this workspace.",
              });
          }
          const versionRows = await transaction.query<{ version: number }>(
            "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM artifact_version WHERE artifact_id = ?",
            [artifactId],
          );
          artifact.version = versionRows[0]?.version ?? 1;
          let blobId: string;
          const blobs = await transaction.query<{ id: string }>(
            "SELECT id FROM blob_object WHERE storage_key = ?",
            [stored.storageKey],
          );
          if (blobs[0] === undefined) {
            blobId = this.#newId();
            await transaction.execute(
              "INSERT INTO blob_object (id, storage_key, sha256, size, media_type, state, created_at) VALUES (?, ?, ?, ?, ?, 'available', ?)",
              [blobId, stored.storageKey, stored.sha256, stored.size, metadata.mediaType, now],
            );
          } else {
            blobId = blobs[0].id;
          }
          const label = createDefaultSecurityLabel({
            id: "stable-default",
            purpose: "personal_task",
          });
          await transaction.execute(
            "INSERT OR IGNORE INTO security_label (id, version, purpose_rules, member_rules, model_recipient_rules, target_domain_rules, public_visibility, cache_and_retention, untrusted_content, review_history) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              label.id,
              label.version,
              JSON.stringify(label.purposeRules),
              JSON.stringify(label.memberRules),
              JSON.stringify(label.modelRecipientRules),
              JSON.stringify(label.targetDomainRules),
              label.publicVisibility ? 1 : 0,
              JSON.stringify(label.cacheAndRetention),
              label.untrustedContent ? 1 : 0,
              JSON.stringify(label.reviewHistory),
            ],
          );
          await transaction.execute(
            `INSERT INTO artifact_version (id, artifact_id, version, blob_id, kind, origin_type, origin_id, run_id, attribution, security_label_id, source_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              artifactVersionId,
              artifactId,
              artifact.version,
              blobId,
              metadata.kind,
              metadata.runId === undefined ? "workspace" : "run",
              metadata.runId ?? workspaceId,
              metadata.runId ?? null,
              JSON.stringify({
                actorId,
                displayNameAtTime: "Personal Owner",
                rolesAtTime: ["owner"],
                occurredAt: now,
              }),
              label.id,
              metadata.sourceSummary,
            ],
          );
          await transaction.execute(
            "INSERT INTO artifact_metadata (artifact_version_id, name, media_type, created_at) VALUES (?, ?, ?, ?)",
            [artifactVersionId, metadata.name, metadata.mediaType, now],
          );
        },
        events: [
          {
            type: "artifact.version_created",
            schemaVersion: 1,
            occurredAt: now,
            ...(metadata.runId === undefined ? {} : { runId: metadata.runId }),
            visibility: { kind: "workspace_members" },
            payloadDigest: commandDigest,
            payload: { artifactId, artifactVersionId, sha256: stored.sha256 },
          },
        ],
      });
      return { response: result.response, replayed: result.replayed };
    } catch (error) {
      if (error instanceof CommandRevisionConflictError)
        throw new ProblemError("revision_conflict");
      throw error;
    }
  }

  async get(
    actorId: string,
    workspaceId: string,
    artifactId: string,
    version?: number,
  ): Promise<Record<string, unknown>> {
    await assertWorkspace(this.#database, actorId, workspaceId);
    const rows = await this.#database.query<Record<string, unknown>>(
      `${ARTIFACT_SELECT}
       WHERE av.artifact_id = ?
         AND (av.origin_id = ? OR av.run_id IN (SELECT id FROM run WHERE workspace_id = ?))
         ${version === undefined ? "" : "AND av.version = ?"}
       ORDER BY av.version DESC LIMIT 1`,
      version === undefined
        ? [artifactId, workspaceId, workspaceId]
        : [artifactId, workspaceId, workspaceId, version],
    );
    const artifact = rows[0];
    if (artifact === undefined) throw new ProblemError("not_found");
    return artifact;
  }

  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<{ artifacts: Record<string, unknown>[] }> {
    await assertWorkspace(this.#database, actorId, workspaceId);
    const artifacts = await this.#database.query<Record<string, unknown>>(
      `${ARTIFACT_SELECT}
       WHERE av.origin_id = ? OR av.run_id IN (SELECT id FROM run WHERE workspace_id = ?)
       ORDER BY av.artifact_id, av.version DESC`,
      [workspaceId, workspaceId],
    );
    return { artifacts };
  }

  async content(
    actorId: string,
    workspaceId: string,
    artifactId: string,
    version?: number,
  ): Promise<{ artifact: Record<string, unknown>; bytes: Uint8Array }> {
    const artifact = await this.get(actorId, workspaceId, artifactId, version);
    try {
      const bytes = await this.#objects.get(String(artifact.sha256));
      return { artifact, bytes };
    } catch {
      throw new ProblemError("not_found", { detail: "Artifact content is unavailable." });
    }
  }

  async preview(
    actorId: string,
    workspaceId: string,
    artifactId: string,
    version?: number,
  ): Promise<{ artifact: Record<string, unknown>; preview: Record<string, unknown> }> {
    const { artifact, bytes } = await this.content(actorId, workspaceId, artifactId, version);
    const mediaType = String(artifact.mediaType).toLowerCase();
    if (mediaType.startsWith("text/") || mediaType === "application/json") {
      const sliced = bytes.subarray(0, 65_536);
      return {
        artifact,
        preview: {
          kind: "text",
          mediaType: "text/plain",
          text: new TextDecoder().decode(sliced),
          truncated: bytes.byteLength > sliced.byteLength,
        },
      };
    }
    if (
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType) &&
      bytes.byteLength <= 2 * 1024 * 1024
    ) {
      return {
        artifact,
        preview: {
          kind: "image",
          mediaType,
          dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
        },
      };
    }
    return { artifact, preview: { kind: "unavailable" } };
  }
}

export function createArtifactService(options: ArtifactServiceOptions): ArtifactService {
  return new ArtifactService(options);
}
