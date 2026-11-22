import { useState } from "react";
import type { DataRights } from "../../../../../apps/runner-api/src/federation/propagation";

export interface GrantEditorProps {
  readonly onDecide: (
    decision: "active" | "rejected" | "revoked",
    rights: DataRights,
    usageLimit: number,
  ) => Promise<void>;
}

const LABELS: Record<keyof DataRights, string> = {
  modelDisclose: "Allow model disclosure (untrusted output)",
  memberDisclose: "Allow workspace-member disclosure",
  publicTimeline: "Allow public timeline",
  domainPropagate: "Allow recipient-node propagation",
  centralCache: "Allow central cache",
  offlineRead: "Allow offline reads",
};

export function GrantEditor({ onDecide }: GrantEditorProps) {
  const [rights, setRights] = useState<DataRights>({
    modelDisclose: false,
    memberDisclose: false,
    publicTimeline: false,
    domainPropagate: false,
    centralCache: false,
    offlineRead: false,
  });
  const [usageLimit, setUsageLimit] = useState(1);
  return (
    <section className="panel" data-testid="grant-editor" aria-labelledby="grant-editor-title">
      <h2 id="grant-editor-title">Grant request and reduction</h2>
      <p>
        Every right is off by default. Reducing a right removes access only on future reads; it
        never revokes effects already recorded.
      </p>
      {(Object.keys(LABELS) as (keyof DataRights)[]).map((field) => (
        <label key={field}>
          <input
            type="checkbox"
            checked={rights[field]}
            onChange={(event) =>
              setRights((current) => ({ ...current, [field]: event.target.checked }))
            }
          />
          {LABELS[field]}
        </label>
      ))}
      <label htmlFor="grant-usage-limit">
        Maximum operations
        <input
          id="grant-usage-limit"
          type="number"
          min={1}
          value={usageLimit}
          onChange={(event) => setUsageLimit(Math.max(1, Number(event.target.value)))}
        />
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void onDecide("active", rights, usageLimit);
          }}
        >
          Approve grant
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            void onDecide("rejected", rights, usageLimit);
          }}
        >
          Reject
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            void onDecide("revoked", rights, usageLimit);
          }}
        >
          Revoke
        </button>
      </div>
    </section>
  );
}
