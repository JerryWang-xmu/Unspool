import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import {
  createObjectStore,
  type ObjectStore,
} from "../../../../packages/persistence/src/object-store.js";
import { loadWorkspaceAccess } from "../workspaces/service.js";
import { createEvidenceState, type EvidenceActor, type WorkspaceEvidenceState } from "./state.js";

export class EvidenceRegistry {
  readonly #states = new Map<string, WorkspaceEvidenceState>();
  readonly #database: SqliteDatabase;
  readonly #objects: ObjectStore | undefined;

  constructor(database: SqliteDatabase, dataDir?: string) {
    this.#database = database;
    this.#objects = dataDir === undefined ? undefined : createObjectStore({ directory: dataDir });
  }

  get(workspaceId: string): WorkspaceEvidenceState {
    let state = this.#states.get(workspaceId);
    if (state === undefined) {
      state = { ...createEvidenceState(workspaceId), id: workspaceId };
      this.#states.set(workspaceId, state);
    }
    return state;
  }

  async actor(actorId: string, workspaceId: string): Promise<EvidenceActor> {
    const access = await loadWorkspaceAccess(this.#database, actorId, workspaceId);
    const state = this.get(workspaceId);
    state.name = access.workspace.name;
    state.goal = access.workspace.goal;
    state.completionCriteria = access.workspace.completionCriteria;
    state.status = access.workspace.status;
    const runs = await this.#database.query<{ id: string; state: string; result: string | null }>(
      `SELECT r.id, r.state, ca.result
         FROM run r LEFT JOIN completion_assessment ca ON ca.run_id = r.id
        WHERE r.workspace_id = ? ORDER BY r.sequence`,
      [workspaceId],
    );
    state.runs.clear();
    for (const run of runs)
      state.runs.set(run.id, {
        id: run.id,
        state: run.state,
        ...(run.result === null ? {} : { result: run.result }),
      });
    if (this.#objects !== undefined) {
      const artifacts = await this.#database.query<Record<string, unknown>>(
        `SELECT av.id, av.run_id AS runId, am.name, bo.sha256, bo.size
           FROM artifact_version av
           JOIN artifact_metadata am ON am.artifact_version_id = av.id
           JOIN blob_object bo ON bo.id = av.blob_id
          LEFT JOIN run r ON r.id = av.run_id
         WHERE av.origin_id = ? OR r.workspace_id = ?`,
        [workspaceId, workspaceId],
      );
      for (const artifact of artifacts) {
        const sha256 = String(artifact.sha256);
        let bytes: Uint8Array | null = null;
        let unknown = false;
        try {
          bytes = await this.#objects.get(sha256);
        } catch {
          unknown = true;
        }
        const id = String(artifact.id);
        state.artifacts.set(id, {
          id,
          name: String(artifact.name),
          bytes,
          declaredSize: Number(artifact.size),
          sha256,
          deleted: false,
          inaccessible: false,
          unknown,
          ...(artifact.runId === null || artifact.runId === undefined
            ? {}
            : { runId: String(artifact.runId) }),
        });
      }
    }
    return {
      id: actorId,
      displayName: actorId,
      kind: "human",
      role: access.role,
      canReview: access.canReview,
      canApprove: access.canApprove,
    };
  }
}
