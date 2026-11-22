import { useEffect, useId, useMemo, useState } from "react";
import type {
  CollaborationClient,
  SharePreview as SharePreviewResult,
  TeamMember,
  WorkspaceRole,
} from "../../api/collaborationTypes";
import type { WorkspaceDetail } from "../../api/types";
import { SharedBadge } from "./SharedBadge";

export type ShareMemberRole = Exclude<WorkspaceRole, "owner">;

export interface ShareRecordOption {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly summary?: string | undefined;
  readonly memberVisibility?: "members" | "private" | undefined;
}

export interface ShareMemberSelection {
  readonly userId: string;
  readonly role: ShareMemberRole;
  readonly canApprove: boolean;
  readonly canReview: boolean;
}

export interface SharePreviewProps {
  readonly client: CollaborationClient;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly records: readonly ShareRecordOption[];
  readonly currentUserId?: string | undefined;
  readonly onConverted?: ((workspace: WorkspaceDetail) => void) | undefined;
}

const DEFAULT_EXCLUSIONS: readonly string[] = [
  "Credentials and model configuration",
  "Personal preferences",
  "Local drafts and unpublished suggestions",
  "Private handoff questions and answers",
  "Any record that is not explicitly selected below",
];

const SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set([
  "credential",
  "credentials",
  "secret",
  "secrets",
  "preference",
  "preferences",
  "draft",
  "drafts",
  "private",
  "private_qa",
  "handoff_private",
  "private_handoff",
]);

const MEMBER_ROLE_LABELS: Readonly<Record<ShareMemberRole, string>> = {
  operator: "Operator",
  contributor: "Contributor",
  observer: "Observer",
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function normalizedCategory(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function isPrivateRecord(record: ShareRecordOption): boolean {
  return (
    record.memberVisibility === "private" ||
    SENSITIVE_CATEGORIES.has(normalizedCategory(record.category))
  );
}

function isMemberEligible(member: TeamMember, now: number): boolean {
  if (member.status !== "active") {
    return false;
  }
  const effective = member.effectiveStatus?.toLowerCase();
  if (
    effective !== undefined &&
    ["disabled", "expired", "inactive", "left", "removed"].some((value) =>
      effective.includes(value),
    )
  ) {
    return false;
  }
  if (member.expiresAt !== null && member.expiresAt !== undefined) {
    const expiresAt = Date.parse(member.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      return false;
    }
  }
  return true;
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export function SharePreview({
  client,
  workspaceId,
  teamId,
  records,
  currentUserId,
  onConverted,
}: SharePreviewProps) {
  const titleId = useId();
  const previewTitleId = useId();
  const membersTitleId = useId();
  const memberFieldId = useId();
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<SharePreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<readonly TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersReload, setMembersReload] = useState(0);
  const [memberSelections, setMemberSelections] = useState<
    Readonly<Record<string, ShareMemberSelection>>
  >({});
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [converted, setConverted] = useState<WorkspaceDetail | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const normalizedTeamId = teamId.trim();
  const locked = converted !== null;

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const allowed = new Set(
      records.filter((record) => !isPrivateRecord(record)).map((record) => record.id),
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => allowed.has(id));
      return next.length === current.length ? current : next;
    });
  }, [records]);

  useEffect(() => {
    void normalizedTeamId;
    setMemberSelections({});
  }, [normalizedTeamId]);

  useEffect(() => {
    void membersReload;
    if (normalizedTeamId.length === 0) {
      setTeamMembers([]);
      setMembersLoading(false);
      setMembersError(null);
      return;
    }
    let active = true;
    setMembersLoading(true);
    setMembersError(null);
    void client
      .listTeamMembers(normalizedTeamId)
      .then((members) => {
        if (active) {
          setTeamMembers(members);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setTeamMembers([]);
          setMembersError(`Team members are unavailable: ${errorMessage(cause)}`);
        }
      })
      .finally(() => {
        if (active) {
          setMembersLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, membersReload, normalizedTeamId]);

  const recordGroups = useMemo(() => {
    const groups = new Map<string, ShareRecordOption[]>();
    for (const record of records) {
      const category = record.category.trim().length === 0 ? "Uncategorized" : record.category;
      const group = groups.get(category);
      if (group === undefined) {
        groups.set(category, [record]);
      } else {
        group.push(record);
      }
    }
    return [...groups.entries()];
  }, [records]);

  const shareableRecords = useMemo(
    () => records.filter((record) => !isPrivateRecord(record)),
    [records],
  );
  const privateRecords = useMemo(
    () => records.filter((record) => isPrivateRecord(record)),
    [records],
  );
  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.includes(record.id)),
    [records, selectedIds],
  );
  const selectedMemberList = useMemo(
    () =>
      Object.values(memberSelections).filter((selection) =>
        teamMembers.some(
          (member) => member.userId === selection.userId && isMemberEligible(member, now),
        ),
      ),
    [memberSelections, now, teamMembers],
  );
  const excludedByRunner =
    preview !== null && Array.isArray(preview.excludedCategories) ? preview.excludedCategories : [];

  const previewExpiresAt = preview === null ? Number.NaN : Date.parse(preview.expiresAt);
  const previewExpirationReadable = preview !== null && Number.isFinite(previewExpiresAt);
  const previewExpired =
    preview !== null && (!previewExpirationReadable || previewExpiresAt <= now);

  function toggleRecord(recordId: string): void {
    if (locked) {
      return;
    }
    setSelectedIds((current) =>
      current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId],
    );
    setPreview(null);
    setPreviewError(null);
    setConvertError(null);
  }

  function clearSelection(): void {
    if (locked) {
      return;
    }
    setSelectedIds([]);
    setPreview(null);
    setPreviewError(null);
    setConvertError(null);
  }

  async function handleCreatePreview(): Promise<void> {
    if (locked) {
      return;
    }
    const selection = selectedIds.filter((id) =>
      shareableRecords.some((record) => record.id === id),
    );
    if (selection.length === 0) {
      setPreviewError("Select at least one shareable record before creating a preview.");
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    setConvertError(null);
    try {
      const result = await client.createSharePreview(workspaceId, selection);
      const confirmed = Array.isArray(result.selectedRecordIds) ? result.selectedRecordIds : [];
      const requested = new Set(selection);
      const matchesSelection =
        confirmed.length === requested.size &&
        new Set(confirmed).size === confirmed.length &&
        confirmed.every((id) => requested.has(id));
      if (result.sourceWorkspaceId !== workspaceId || !matchesSelection) {
        setPreview(null);
        setPreviewError(
          "The Runner returned a preview that does not match this workspace and explicit selection. Conversion was not enabled; create the preview again.",
        );
        return;
      }
      setPreview(result);
    } catch (cause) {
      setPreview(null);
      setPreviewError(`Share preview was not created: ${errorMessage(cause)}`);
    } finally {
      setPreviewBusy(false);
    }
  }

  function toggleMember(member: TeamMember): void {
    if (locked || converting || !isMemberEligible(member, now)) {
      return;
    }
    setMemberSelections((current) => {
      if (current[member.userId] !== undefined) {
        const next = { ...current };
        delete next[member.userId];
        return next;
      }
      return {
        ...current,
        [member.userId]: {
          userId: member.userId,
          role: "contributor",
          canApprove: false,
          canReview: false,
        },
      };
    });
    setConvertError(null);
  }

  function updateMemberRole(userId: string, role: ShareMemberRole): void {
    setMemberSelections((current) => {
      const existing = current[userId];
      if (existing === undefined) {
        return current;
      }
      return { ...current, [userId]: { ...existing, role } };
    });
    setConvertError(null);
  }

  function updateMemberPermission(
    userId: string,
    permission: "canApprove" | "canReview",
    value: boolean,
  ): void {
    setMemberSelections((current) => {
      const existing = current[userId];
      if (existing === undefined) {
        return current;
      }
      return { ...current, [userId]: { ...existing, [permission]: value } };
    });
    setConvertError(null);
  }

  async function handleConvert(): Promise<void> {
    if (locked || converting) {
      return;
    }
    if (preview === null) {
      setConvertError("Create a share preview for the current selection before converting.");
      return;
    }
    if (!previewExpirationReadable) {
      setConvertError(
        "The Runner returned a preview without a readable expiration. Conversion is blocked until a valid preview exists.",
      );
      return;
    }
    if (previewExpired) {
      setConvertError(
        "This share preview has expired. Create a new preview for the current selection.",
      );
      return;
    }
    if (normalizedTeamId.length === 0) {
      setConvertError("A team is required before the personal task can be converted.");
      return;
    }
    if (selectedMemberList.length === 0) {
      setConvertError("Select at least one initial member for the shared workspace.");
      return;
    }

    setConverting(true);
    setConvertError(null);
    try {
      const workspace = await client.convertPersonalTaskToShared(workspaceId, {
        sharePreviewId: preview.id,
        teamId: normalizedTeamId,
        members: selectedMemberList.map((selection) => ({
          userId: selection.userId,
          role: selection.role,
          canApprove: selection.canApprove,
          canReview: selection.canReview,
        })),
      });
      if (workspace.kind !== "shared") {
        setConvertError(
          `The Runner returned a workspace with kind "${workspace.kind}" instead of "shared". Conversion is not confirmed; review the workspace before using it.`,
        );
        return;
      }
      setConverted(workspace);
      onConverted?.(workspace);
    } catch (cause) {
      setConvertError(`Conversion to a shared workspace failed: ${errorMessage(cause)}`);
    } finally {
      setConverting(false);
    }
  }

  const canCreatePreview =
    !locked && !previewBusy && selectedIds.length > 0 && shareableRecords.length > 0;
  const canConvert =
    !locked &&
    !converting &&
    preview !== null &&
    !previewExpired &&
    previewExpirationReadable &&
    normalizedTeamId.length > 0 &&
    selectedMemberList.length > 0;

  return (
    <section className="panel" data-testid="share-preview" aria-labelledby={titleId}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Selective sharing</p>
          <h2 id={titleId}>Preview what becomes shared</h2>
          <p className="panel__hint">
            The personal task stays in place. Only the records you explicitly select are copied into
            the new shared workspace.
          </p>
        </div>
        {converted !== null ? (
          <SharedBadge kind={converted.kind} teamId={converted.teamId} status={converted.status} />
        ) : null}
      </div>

      <p className="notice notice--warning" role="note">
        Never shared by default:
      </p>
      <ul className="field__hint">
        {DEFAULT_EXCLUSIONS.map((exclusion) => (
          <li key={exclusion}>{exclusion}</li>
        ))}
      </ul>

      <section aria-labelledby={previewTitleId}>
        <h3 id={previewTitleId}>1. Choose records explicitly</h3>
        <p className="field__hint">
          Selection starts empty. Private records cannot be selected, and changing the selection
          requires a new preview.
        </p>

        {records.length === 0 ? (
          <p className="status-text" role="status">
            No records were provided for sharing. The preview stays unavailable rather than assuming
            that everything is shareable.
          </p>
        ) : (
          recordGroups.map(([category, group]) => (
            <fieldset key={category} className="field">
              <legend>{category}</legend>
              <ul className="tool-list">
                {group.map((record) => {
                  const privateRecord = isPrivateRecord(record);
                  const checked = selectedIds.includes(record.id);
                  return (
                    <li key={record.id} className="tool-call" data-testid="share-record">
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRecord(record.id)}
                          disabled={privateRecord || locked}
                        />
                        <strong> {record.title}</strong>
                      </label>
                      <div className="tool-call__header">
                        <span className={privateRecord ? "tag tag--warning" : "tag"}>
                          {privateRecord ? "Private - never copied" : "Shareable"}
                        </span>
                        <span>{record.id}</span>
                      </div>
                      {record.summary !== undefined && record.summary.trim().length > 0 ? (
                        <p className="field__hint">{record.summary}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))
        )}

        <p className="field__hint">
          {selectedIds.length} of {shareableRecords.length} shareable records selected. Unselected
          records remain private.
        </p>

        {privateRecords.length > 0 ? (
          <div className="notice notice--warning" role="note">
            <strong>Excluded private records:</strong>{" "}
            {privateRecords.map((record) => record.title).join(", ")}. Their categories and contents
            are not copied into the shared workspace.
          </div>
        ) : null}

        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
            data-testid="create-share-preview"
            onClick={() => {
              void handleCreatePreview();
            }}
            disabled={!canCreatePreview}
            aria-busy={previewBusy}
          >
            {previewBusy ? "Creating preview..." : "Create share preview"}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={clearSelection}
            disabled={locked || previewBusy || selectedIds.length === 0}
          >
            Clear selection
          </button>
        </div>

        {previewError !== null ? (
          <p className="notice notice--error" role="alert">
            {previewError}
          </p>
        ) : null}

        {preview !== null ? (
          <div className="notice notice--success" role="status" data-testid="share-preview-result">
            <p>
              Preview <strong>{preview.id}</strong> created by {preview.createdBy}; it covers{" "}
              {preview.selectedRecordIds.length} selected record
              {preview.selectedRecordIds.length === 1 ? "" : "s"}.
            </p>
            <p>
              {previewExpirationReadable
                ? `Expires ${formatTimestamp(preview.expiresAt)}.`
                : "The Runner did not return a readable expiration."}
            </p>
            <p>
              Runner-confirmed exclusions:{" "}
              {excludedByRunner.length === 0
                ? "none reported in addition to the default exclusions above"
                : excludedByRunner.join(", ")}
              .
            </p>
            {previewExpired ? (
              <p className="notice notice--error" role="alert">
                This preview has expired. Create a new preview before conversion.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby={membersTitleId}>
        <h3 id={membersTitleId}>2. Convert with initial members</h3>
        <p className="field__hint">
          The owner is added by the Runner. Select at least one other active team member and set
          every role, approval, and review permission explicitly. The selected records are copied
          with their recorded attribution; excluded and unselected private content is not.
        </p>

        {normalizedTeamId.length === 0 ? (
          <p className="notice notice--warning" role="status">
            A team ID is required before conversion.
          </p>
        ) : (
          <>
            <p className="field__hint">
              Team: <strong>{normalizedTeamId}</strong>
              {currentUserId === undefined
                ? ""
                : ` · ${currentUserId} is treated as the owner and is not listed`}
              .
            </p>

            {membersLoading ? (
              <p className="status-text" role="status">
                Loading active team members...
              </p>
            ) : null}
            {membersError !== null ? (
              <div className="notice notice--error" role="alert">
                <p>{membersError}</p>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setMembersReload((current) => current + 1)}
                  disabled={membersLoading}
                >
                  Retry team members
                </button>
              </div>
            ) : null}
            {!membersLoading && membersError === null && teamMembers.length === 0 ? (
              <p className="status-text" role="status">
                The Runner returned no team members. Conversion requires at least one initial member
                beyond the owner.
              </p>
            ) : null}

            {teamMembers.length > 0 ? (
              <ul className="tool-list">
                {teamMembers.map((member, index) => {
                  if (currentUserId !== undefined && member.userId === currentUserId) {
                    return null;
                  }
                  const selection = memberSelections[member.userId];
                  const eligible = isMemberEligible(member, now);
                  const roleFieldId = `${memberFieldId}-${String(index)}-role`;
                  return (
                    <li
                      key={member.id}
                      className="tool-call"
                      data-testid="share-member"
                      data-member-id={member.userId}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={selection !== undefined}
                          onChange={() => toggleMember(member)}
                          disabled={locked || converting || !eligible}
                        />
                        <strong> {member.userId}</strong>
                      </label>
                      <div className="tool-call__header">
                        <span className={eligible ? "tag tag--active" : "tag tag--warning"}>
                          {member.effectiveStatus ?? member.status}
                        </span>
                        {member.expiresAt !== null && member.expiresAt !== undefined ? (
                          <span>Expires {formatTimestamp(member.expiresAt)}</span>
                        ) : null}
                        {!eligible ? <span>Not eligible for this conversion</span> : null}
                      </div>

                      {selection !== undefined ? (
                        <div className="field-grid">
                          <div className="field">
                            <label htmlFor={roleFieldId}>Role</label>
                            <select
                              id={roleFieldId}
                              value={selection.role}
                              onChange={(event) =>
                                updateMemberRole(
                                  member.userId,
                                  event.currentTarget.value as ShareMemberRole,
                                )
                              }
                              disabled={locked || converting}
                            >
                              {(Object.keys(MEMBER_ROLE_LABELS) as ShareMemberRole[]).map(
                                (role) => (
                                  <option key={role} value={role}>
                                    {MEMBER_ROLE_LABELS[role]}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                          <div className="field">
                            <label>
                              <input
                                type="checkbox"
                                checked={selection.canApprove}
                                onChange={(event) =>
                                  updateMemberPermission(
                                    member.userId,
                                    "canApprove",
                                    event.currentTarget.checked,
                                  )
                                }
                                disabled={locked || converting}
                              />{" "}
                              Can approve high-risk actions
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={selection.canReview}
                                onChange={(event) =>
                                  updateMemberPermission(
                                    member.userId,
                                    "canReview",
                                    event.currentTarget.checked,
                                  )
                                }
                                disabled={locked || converting}
                              />{" "}
                              Can review conclusions and evidence
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}

        <p className="field__hint">
          Conversion requires the source personal task to have no active Run. If the Runner rejects
          it, the error below is the authoritative result; this view never reports success on its
          own.
        </p>

        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
            data-testid="convert-shared"
            onClick={() => {
              void handleConvert();
            }}
            disabled={!canConvert}
            aria-busy={converting}
          >
            {converting ? "Converting..." : "Convert to shared workspace"}
          </button>
        </div>

        {convertError !== null ? (
          <p className="notice notice--error" role="alert">
            {convertError}
          </p>
        ) : null}

        {converted !== null ? (
          <div className="notice notice--success" role="status" data-testid="converted-workspace">
            <p>
              The Runner created shared workspace <strong>{converted.id}</strong> ({converted.name})
              with {selectedRecords.length} selected record
              {selectedRecords.length === 1 ? "" : "s"}. The original personal task remains in
              place.
            </p>
            <SharedBadge
              kind={converted.kind}
              teamId={converted.teamId}
              status={converted.status}
              detail="persisted workspace state"
            />
          </div>
        ) : null}
      </section>
    </section>
  );
}
