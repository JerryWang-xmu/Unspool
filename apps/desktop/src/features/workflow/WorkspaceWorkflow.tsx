import { useCallback, useEffect, useState } from "react";
import type { HandoffSummary } from "../../../../../packages/domain/src/handoff-summary";
import type { CollaborationClient } from "../../api/collaborationTypes";
import type { RunDetail, RunnerClient, TimelineEvent, WorkspaceDetail } from "../../api/types";
import type { WorkflowClient } from "../../api/workflowClient";
import { ArchiveExplorer } from "../archive/ArchiveExplorer";
import { ConclusionBoard, type ConclusionBoardItem } from "../evidence/ConclusionBoard";
import { ImpactReview } from "../evidence/ImpactReview";
import { HandoffInvitation } from "../handoffs/HandoffInvitation";
import { type PreparationQA, PreparationWorkspace } from "../handoffs/PreparationWorkspace";
import type { ShareRecordOption } from "../sharing/SharePreview";
import { SharePreview } from "../sharing/SharePreview";

interface ArchiveExportView {
  readonly id: string;
  readonly scope: string;
  readonly exportedAt: string;
  readonly missingItems: readonly string[];
  readonly unknownItems: readonly string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function idOf(value: unknown): string {
  return typeof value === "object" && value !== null
    ? text((value as Record<string, unknown>).id)
    : "";
}
function items<T = Record<string, unknown>>(value: unknown, ...keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "object" || value === null) return [];
  for (const key of [...keys, "items"]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) return candidate as T[];
  }
  return [];
}

export interface WorkspaceWorkflowProps {
  readonly workspace: WorkspaceDetail;
  readonly run: RunDetail | null;
  readonly events: readonly TimelineEvent[];
  readonly collaboration: CollaborationClient;
  readonly workflow: WorkflowClient;
  readonly artifactClient: Pick<RunnerClient, "listArtifacts">;
  readonly onOpenWorkspace: (workspaceId: string) => Promise<void>;
}

export function WorkspaceWorkflow({
  workspace,
  run,
  events,
  collaboration,
  workflow,
  artifactClient,
  onOpenWorkspace,
}: WorkspaceWorkflowProps) {
  const [actorId, setActorId] = useState("");
  const [teams, setTeams] = useState<readonly Record<string, unknown>[]>([]);
  const [teamId, setTeamId] = useState("");
  const [records, setRecords] = useState<readonly ShareRecordOption[]>([]);
  const [handoff, setHandoff] = useState<Record<string, unknown> | null>(null);
  const [preparation, setPreparation] = useState<Record<string, unknown> | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [questions, setQuestions] = useState<readonly PreparationQA[]>([]);
  const [conclusions, setConclusions] = useState<readonly ConclusionBoardItem[]>([]);
  const [selectedConclusionId, setSelectedConclusionId] = useState("");
  const [exports, setExports] = useState<readonly ArchiveExportView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handoffId = idOf(handoff);
  const latestRevision = Number(
    preparation?.latestRevision ?? preparation?.latest_revision ?? workspace.revision ?? 1,
  );

  const refreshConclusions = useCallback(async () => {
    const result = await workflow.listConclusions(workspace.id);
    const next = items<ConclusionBoardItem>(result, "conclusions").map((item) => ({
      ...item,
      sources: item.sources ?? [],
    }));
    setConclusions(next);
    setSelectedConclusionId((current) =>
      next.some((item) => item.id === current) ? current : (next[0]?.id ?? ""),
    );
  }, [workflow, workspace.id]);
  const refreshExports = useCallback(async () => {
    setExports(
      items<ArchiveExportView>(await workflow.listArchiveExports(workspace.id), "exports"),
    );
  }, [workflow, workspace.id]);

  useEffect(() => {
    let active = true;
    void workflow
      .getMe()
      .then((actor) => {
        if (active) setActorId(actor.id);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [workflow]);
  useEffect(() => {
    if (workspace.kind !== "personal") return;
    void workflow
      .listTeams()
      .then((result) => {
        const next = items(result, "teams");
        setTeams(next);
        setTeamId((current) =>
          next.some((team) => idOf(team) === current) ? current : idOf(next[0]),
        );
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [workflow, workspace.kind]);
  useEffect(() => {
    void events.length;
    if (workspace.kind !== "personal") return;
    void Promise.all([
      collaboration.listContextItems(workspace.id),
      artifactClient.listArtifacts(workspace.id),
    ])
      .then(([context, artifacts]) => {
        setRecords([
          ...context.map((item) => ({
            id: item.currentVersionId,
            title: item.currentVersion.title,
            category: item.kind,
            summary: item.currentVersion.body,
            memberVisibility: item.currentVersion.memberVisibility,
          })),
          ...artifacts.map((artifact) => ({
            id: artifact.artifactVersionId ?? artifact.id,
            title: artifact.name,
            category: "artifact",
            summary: artifact.sourceSummary,
          })),
        ]);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [workspace.id, workspace.kind, collaboration, artifactClient, events.length]);
  useEffect(() => {
    void events.length;
    if (workspace.kind !== "shared") return;
    void refreshConclusions().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
    void refreshExports().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [workspace.kind, events.length, refreshConclusions, refreshExports]);
  useEffect(() => {
    for (const event of events) {
      if (event.type === "handoff.invited" && text(event.payload.handoffId).length > 0) {
        if (text(event.payload.recipientId) === actorId || handoffId.length === 0) {
          setHandoff({
            id: text(event.payload.handoffId),
            recipientId: text(event.payload.recipientId),
          });
        }
      }
    }
  }, [events, actorId, handoffId]);

  const summary = (preparation?.summary ?? preparation?.handoffSummary) as
    | HandoffSummary
    | undefined;
  const canPrepare = handoffId.length > 0 && text(handoff?.recipientId) === actorId;
  const selectedConclusion = conclusions.find((item) => item.id === selectedConclusionId) ?? null;

  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workflow" data-testid="workspace-workflow" aria-label="Workspace workflow">
      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {workspace.kind === "personal" ? (
        <section className="panel" aria-labelledby="selective-share-title">
          <h2 id="selective-share-title">Selective sharing</h2>
          <label htmlFor="share-team">
            Destination team
            <select
              id="share-team"
              data-testid="share-team-select"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              {teams.map((team) => (
                <option key={idOf(team)} value={idOf(team)}>
                  {text(team.name) || idOf(team)}
                </option>
              ))}
            </select>
          </label>
          {teamId.length > 0 ? (
            <SharePreview
              client={collaboration}
              workspaceId={workspace.id}
              teamId={teamId}
              records={records}
              currentUserId={actorId}
              onConverted={(converted) => {
                void onOpenWorkspace(converted.id);
              }}
            />
          ) : (
            <p>No destination team is available.</p>
          )}
        </section>
      ) : (
        <>
          <section className="panel" aria-labelledby="handoff-controls-title">
            <h2 id="handoff-controls-title">Invite and prepare a responsibility handoff</h2>
            <label htmlFor="handoff-recipient">
              Recipient member ID
              <input
                id="handoff-recipient"
                data-testid="handoff-recipient"
                value={recipientId}
                onChange={(event) => setRecipientId(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button--ghost"
              data-testid="invite-handoff"
              disabled={busy || recipientId.trim().length === 0}
              onClick={() => {
                void runAction(async () => {
                  const created = await workflow.inviteHandoff(workspace.id, {
                    recipientId: recipientId.trim(),
                    reason: "Review the current responsibility and evidence",
                  });
                  setHandoff({ ...created });
                });
              }}
            >
              Invite recipient
            </button>
            {canPrepare && preparation === null ? (
              <button
                type="button"
                className="button button--primary"
                data-testid="prepare-handoff"
                disabled={busy}
                onClick={() => {
                  void runAction(async () => {
                    setPreparation({ ...(await workflow.prepareHandoff(workspace.id, handoffId)) });
                  });
                }}
              >
                Start private preparation
              </button>
            ) : null}
          </section>

          {preparation !== null && summary !== undefined && handoff !== null ? (
            <HandoffInvitation
              invitation={{
                id: handoffId,
                recipientId: text(handoff?.recipientId) || actorId,
                status: text(handoff?.status) || "preparing",
                baseRevision: latestRevision,
                latestRevision,
              }}
              summary={summary}
              currentActorId={actorId}
              busy={busy}
              onRefresh={async () => {
                const refreshed = await workflow.refreshHandoff(workspace.id, handoffId);
                setPreparation((current) => ({ ...current, ...refreshed }));
              }}
              onAccept={async () => {
                await workflow.acceptHandoff(workspace.id, handoffId, latestRevision);
                await onOpenWorkspace(workspace.id);
              }}
              onReject={async (reason) => {
                await workflow.rejectHandoff(workspace.id, handoffId, reason);
                await onOpenWorkspace(workspace.id);
              }}
            />
          ) : null}
          {preparation !== null ? (
            <PreparationWorkspace
              asOfRevision={Number(preparation.asOfRevision ?? preparation.as_of_revision ?? 0)}
              latestRevision={latestRevision}
              questions={questions}
              unresolvedIssues={items(preparation.unresolvedIssues)}
              onAsk={async (question) => {
                const answer = await workflow.askHandoffQuestion(workspace.id, handoffId, {
                  question,
                  asOfRevision: latestRevision,
                });
                const qa: PreparationQA = {
                  id: answer.id,
                  question: answer.question,
                  answer: answer.answer,
                  answerKind: answer.answerKind,
                  citations: answer.citations.map((citation) => ({
                    sourceType: text(citation.sourceType),
                    sourceId: text(citation.sourceId),
                    sourceRevision: Number(citation.sourceRevision),
                    recordedAt: text(citation.recordedAt),
                  })),
                };
                setQuestions((current) => [...current, qa]);
              }}
              onRefresh={async () => {
                const refreshed = await workflow.refreshHandoff(workspace.id, handoffId);
                setPreparation((current) => ({ ...current, ...refreshed }));
              }}
              onRecordIssue={async (body, shared) => {
                await workflow.recordUnresolvedIssue(workspace.id, handoffId, {
                  body,
                  visibility: shared ? "shared" : "private",
                  status: "open",
                });
                const refreshed = await workflow.refreshHandoff(workspace.id, handoffId);
                setPreparation((current) => ({ ...current, ...refreshed }));
              }}
            />
          ) : null}

          <ConclusionBoard conclusions={conclusions} onSelect={setSelectedConclusionId} />
          {selectedConclusion !== null ? (
            <ImpactReview
              conclusionId={selectedConclusion.id}
              impacts={[]}
              conflictSources={selectedConclusion.sources.map((source) => ({
                ...source,
                contentDigest: "Not reported",
              }))}
              onReview={async (newState, reason) => {
                const sourceVersionIds = selectedConclusion.sourceVersionIds?.length
                  ? [...selectedConclusion.sourceVersionIds]
                  : selectedConclusion.sources.map((source) => source.sourceVersionId);
                await workflow.reviewConclusion(workspace.id, selectedConclusion.id, {
                  newState,
                  reason,
                  ...(sourceVersionIds.length === 0 ? {} : { sourceVersionIds }),
                });
                await refreshConclusions();
              }}
            />
          ) : null}

          <ArchiveExplorer
            exports={exports}
            onSearch={(query) => workflow.searchArchive(workspace.id, query)}
            onExport={async (scope) => {
              await workflow.createArchiveExport(workspace.id, {
                scope,
                ...(run === null ? {} : { runIds: [run.id] }),
              });
              await refreshExports();
            }}
            onDownloadManifest={async (exportId) =>
              new Blob(
                [
                  JSON.stringify(
                    await workflow.getArchiveManifest(workspace.id, exportId),
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              )
            }
          />
          <button
            type="button"
            className="button button--danger"
            data-testid="archive-workspace"
            disabled={busy || workspace.status === "archived"}
            onClick={() => {
              void runAction(async () => {
                await workflow.archiveWorkspace(workspace.id, workspace.revision ?? 1);
                await onOpenWorkspace(workspace.id);
              });
            }}
          >
            Archive workspace
          </button>
        </>
      )}
    </section>
  );
}
