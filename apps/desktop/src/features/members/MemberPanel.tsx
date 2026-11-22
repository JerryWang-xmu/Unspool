import { useEffect, useState } from "react";
import type { CollaborationClient, WorkspaceMember } from "../../api/collaborationTypes";
import type { OperatorRef } from "../../api/types";

export type MemberPanelClient = Pick<CollaborationClient, "getWorkspace">;

export interface MemberPanelProps {
  readonly client: MemberPanelClient;
  readonly workspaceId: string;
  readonly members: readonly WorkspaceMember[];
  readonly onlineUserIds?: readonly string[] | undefined;
  readonly displayNames?: Readonly<Record<string, string>> | undefined;
  readonly refreshToken?: number | undefined;
}

export function MemberPanel({
  client,
  workspaceId,
  members,
  onlineUserIds,
  displayNames = {},
  refreshToken = 0,
}: MemberPanelProps) {
  const [operator, setOperator] = useState<OperatorRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void refreshToken;
    let active = true;
    void client
      .getWorkspace(workspaceId)
      .then((workspace) => {
        if (active) {
          setOperator(workspace.currentOperator ?? null);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [client, workspaceId, refreshToken]);
  const online = new Set(onlineUserIds ?? []);
  return (
    <section className="panel" data-testid="member-panel" aria-labelledby="member-panel-title">
      <h2 id="member-panel-title">Members and responsibilities</h2>
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <p data-testid="current-operator">
        Current operator:{" "}
        {operator ? `${operator.operatorId} (epoch ${operator.operatorEpoch})` : "Not reported"}
      </p>
      {members.length === 0 ? (
        <p>No members were provided.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Presence</th>
              <th>Approval</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId} data-testid="member-row" data-user-id={member.userId}>
                <td>{displayNames[member.userId] ?? member.userId}</td>
                <td>
                  {member.role}
                  {operator?.operatorId === member.userId ? " · current operator" : ""}
                </td>
                <td>
                  {onlineUserIds === undefined
                    ? "Presence not reported"
                    : online.has(member.userId)
                      ? "Online"
                      : "Offline"}
                </td>
                <td>{member.canApprove ? "Can approve" : "Cannot approve"}</td>
                <td>{member.canReview ? "Can review" : "Cannot review"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
