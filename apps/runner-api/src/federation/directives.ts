export type NodeDirectiveState = "active" | "paused" | "revoked" | "quarantined";

export class NodeDirectiveService {
  readonly #states = new Map<
    string,
    { state: NodeDirectiveState; revision: number; tombstones: string[] }
  >();

  apply(nodeId: string, state: NodeDirectiveState, revision: number, reason: string) {
    const current = this.#states.get(nodeId) ?? {
      state: "active" as NodeDirectiveState,
      revision: 0,
      tombstones: [],
    };
    if (revision <= current.revision) return current;
    const next = {
      state,
      revision,
      tombstones:
        state === "revoked" || state === "quarantined"
          ? [...current.tombstones, reason]
          : current.tombstones,
    };
    this.#states.set(nodeId, next);
    return next;
  }

  unquarantine(nodeId: string, revision: number, localOwner: boolean) {
    if (!localOwner) throw new Error("unquarantine_local_only");
    return this.apply(nodeId, "active", revision, "local_unquarantine");
  }

  get(nodeId: string) {
    return (
      this.#states.get(nodeId) ?? {
        state: "active" as NodeDirectiveState,
        revision: 0,
        tombstones: [],
      }
    );
  }

  canUse(nodeId: string): boolean {
    return this.get(nodeId).state === "active";
  }

  recover(nodeId: string, dispatched: boolean, completed: boolean) {
    if (!this.canUse(nodeId)) return { state: "cancelled", autoReplay: false };
    if (dispatched && !completed) return { state: "outcome_unknown", autoReplay: false };
    return { state: completed ? "settled" : "resumable", autoReplay: false };
  }
}
