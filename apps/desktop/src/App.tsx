import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCollaborationClient } from "./api/collaborationClient";
import type { CollaborationClient } from "./api/collaborationTypes";
import { loadHostEnvironment } from "./api/host";
import { createRunnerClient } from "./api/runnerClient";
import type {
  ComposerMode,
  ConnectionState,
  CreatePersonalTaskInput,
  HostEnvironment,
  ModelProfileSummary,
  PersonalTaskSummary,
  RunDetail,
  RunnerClient,
  RunnerHealth,
  RunnerSummary,
  RunSummary,
  StartRunInput,
  TimelineEvent,
  WorkspaceDetail,
} from "./api/types";
import type { WorkflowClient } from "./api/workflowClient";
import { createWorkflowClient } from "./api/workflowClient";
import { ApprovalCenter } from "./features/approvals/ApprovalCenter";
import { ArtifactPanel } from "./features/artifacts/ArtifactPanel";
import { ModeComposer } from "./features/collaboration/ModeComposer";
import { ContextEditor } from "./features/context/ContextEditor";
import { PersonalTaskEditor } from "./features/personal/PersonalTaskEditor";
import { PersonalTaskList, type RecentTaskView } from "./features/personal/PersonalTaskList";
import { RunComposer } from "./features/runs/RunComposer";
import { RunTimeline } from "./features/runs/RunTimeline";
import { isRunActive } from "./features/runs/runState";
import { StartRunDisclosure } from "./features/runs/StartRunDisclosure";
import { RunnerSettings } from "./features/settings/RunnerSettings";
import { WorkspaceWorkflow } from "./features/workflow/WorkspaceWorkflow";
import { WorkspaceOverview } from "./features/workspaces/WorkspaceOverview";

const RECENT_TASK_KEY = "unspool.desktop.recent-task.v1";
const EMPTY_DRAFTS: Readonly<Record<ComposerMode, string>> = {
  start: "",
  steer: "",
  follow_up: "",
};

interface RecentPointer {
  readonly workspaceId: string;
  readonly name: string;
  readonly sessionId: string | null;
  readonly openedAt: string;
}

export interface AppProps {
  readonly client?: RunnerClient;
  readonly collaborationClient?: CollaborationClient;
  readonly workflowClient?: WorkflowClient;
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function readRecentPointer(): RecentPointer | null {
  try {
    const stored = window.localStorage.getItem(RECENT_TASK_KEY);
    if (stored === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.workspaceId !== "string" ||
      record.workspaceId.length === 0 ||
      typeof record.name !== "string" ||
      typeof record.openedAt !== "string"
    ) {
      return null;
    }
    return {
      workspaceId: record.workspaceId,
      name: record.name,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
      openedAt: record.openedAt,
    };
  } catch {
    return null;
  }
}

function writeRecentPointer(pointer: RecentPointer): void {
  try {
    window.localStorage.setItem(RECENT_TASK_KEY, JSON.stringify(pointer));
  } catch {
    // Local history is a convenience; losing it must not break the workspace.
  }
}

function clearRecentPointer(): void {
  try {
    window.localStorage.removeItem(RECENT_TASK_KEY);
  } catch {
    // Ignore storage access failures.
  }
}

function latestRun(runs: readonly RunSummary[]): RunSummary | null {
  const active = runs.find((candidate) => isRunActive(candidate.state));
  if (active !== undefined) {
    return active;
  }
  if (runs.length === 0) {
    return null;
  }
  const sorted = [...runs].sort((left, right) => {
    const leftTime = left.startedAt === undefined ? Number.NaN : Date.parse(left.startedAt);
    const rightTime = right.startedAt === undefined ? Number.NaN : Date.parse(right.startedAt);
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
      return 0;
    }
    if (Number.isNaN(leftTime)) {
      return 1;
    }
    if (Number.isNaN(rightTime)) {
      return -1;
    }
    return rightTime - leftTime;
  });
  return sorted[0] ?? null;
}

interface PendingStartReconciliation {
  readonly previousRunIds: ReadonlySet<string>;
  readonly acceptedRunId: string | null;
}

function acceptedRunFrom(
  runs: readonly RunSummary[],
  pending: PendingStartReconciliation,
): RunSummary | null {
  if (pending.acceptedRunId !== null) {
    return runs.find((candidate) => candidate.id === pending.acceptedRunId) ?? null;
  }
  return latestRun(runs.filter((candidate) => !pending.previousRunIds.has(candidate.id)));
}

function isRunnerSelectable(runner: RunnerSummary): boolean {
  const status = runner.status.toLowerCase();
  return ["available", "online", "connected", "ready", "active", "ok"].some((value) =>
    status.includes(value),
  );
}

function profileDisplay(profile: ModelProfileSummary): string {
  return `${profile.label} (${profile.provider}/${profile.model})`;
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "No successful synchronization yet";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(parsed));
}

function mergeTaskList(
  tasks: readonly PersonalTaskSummary[],
  created: PersonalTaskSummary,
): readonly PersonalTaskSummary[] {
  const existing = tasks.some((task) => task.id === created.id);
  if (existing) {
    return tasks.map((task) => (task.id === created.id ? created : task));
  }
  return [created, ...tasks];
}

export function App({
  client: injectedClient,
  collaborationClient: injectedCollaborationClient,
  workflowClient: injectedWorkflowClient,
}: AppProps = {}) {
  const [client] = useState<RunnerClient>(() => injectedClient ?? createRunnerClient());
  const [collaborationClient] = useState<CollaborationClient>(
    () => injectedCollaborationClient ?? createCollaborationClient({ baseUrl: client.baseUrl }),
  );
  const [workflowClient] = useState<WorkflowClient>(
    () => injectedWorkflowClient ?? createWorkflowClient({ baseUrl: client.baseUrl }),
  );
  const [host, setHost] = useState<HostEnvironment | null>(null);
  const [health, setHealth] = useState<RunnerHealth | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [tasks, setTasks] = useState<readonly PersonalTaskSummary[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [recent, setRecent] = useState<RecentPointer | null>(readRecentPointer);

  const [runners, setRunners] = useState<readonly RunnerSummary[]>([]);
  const [runnersError, setRunnersError] = useState<string | null>(null);
  const [selectedRunnerId, setSelectedRunnerId] = useState("");
  const [modelProfiles, setModelProfiles] = useState<readonly ModelProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [view, setView] = useState<"home" | "task">("home");
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<readonly TimelineEvent[]>([]);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [startUnresolved, setStartUnresolved] = useState(false);

  const [composerModes, setComposerModes] = useState<Readonly<Record<string, ComposerMode>>>({});
  const [composerDrafts, setComposerDrafts] = useState<
    Readonly<Record<string, Readonly<Record<ComposerMode, string>>>>
  >({});
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const restoreAttempted = useRef(false);
  const lastSequence = useRef(0);
  const navigationGeneration = useRef(0);
  const taskDataGeneration = useRef(0);
  const activeWorkspaceId = useRef<string | null>(null);
  const unresolvedStartWorkspaces = useRef(new Map<string, PendingStartReconciliation>());
  const workspaceRef = useRef<WorkspaceDetail | null>(null);
  workspaceRef.current = workspace;

  const refreshHealth = useCallback(async (): Promise<void> => {
    try {
      const nextHealth = await client.getHealth();
      setHealth(nextHealth);
      setConnection(nextHealth.status === "degraded" ? "degraded" : "available");
      setHealthError(null);
      setStale(false);
      setLastSyncedAt(new Date().toISOString());
    } catch (cause) {
      setConnection("offline");
      setHealthError(causeMessage(cause));
      setStale(true);
    }
  }, [client]);

  const refreshTasks = useCallback(async (): Promise<readonly PersonalTaskSummary[]> => {
    setHomeLoading(true);
    try {
      const items = await client.listPersonalTasks();
      setTasks(items);
      setHomeError(null);
      return items;
    } catch (cause) {
      setHomeError(`Personal task history is unavailable: ${causeMessage(cause)}`);
      setStale(true);
      return [];
    } finally {
      setHomeLoading(false);
    }
  }, [client]);

  const refreshRunners = useCallback(async (): Promise<void> => {
    try {
      const items = await client.listRunners();
      setRunners(items);
      setRunnersError(null);
      setSelectedRunnerId((current) => {
        if (current.length > 0 && items.some((runner) => runner.id === current)) {
          return current;
        }
        const preferred = items.find(isRunnerSelectable) ?? items[0];
        return preferred?.id ?? "";
      });
    } catch (cause) {
      setRunnersError(causeMessage(cause));
    }
  }, [client]);

  const addEvents = useCallback((incoming: readonly TimelineEvent[]): void => {
    if (incoming.length === 0) {
      return;
    }
    for (const event of incoming) {
      if (event.sequence !== undefined) {
        lastSequence.current = Math.max(lastSequence.current, event.sequence);
      }
    }
    setEvents((current) => {
      const byId = new Map(current.map((event) => [event.id, event]));
      for (const event of incoming) {
        byId.set(event.id, event);
      }
      const next = [...byId.values()];
      return next.length > 1000 ? next.slice(next.length - 1000) : next;
    });
  }, []);

  const rememberWorkspace = useCallback(
    (task: PersonalTaskSummary, sessionId: string | null): void => {
      setRecent((current) => {
        const effectiveSession =
          sessionId ?? (current?.workspaceId === task.id ? current.sessionId : null);
        if (
          current !== null &&
          current.workspaceId === task.id &&
          current.name === task.name &&
          current.sessionId === effectiveSession
        ) {
          return current;
        }
        const next: RecentPointer = {
          workspaceId: task.id,
          name: task.name,
          sessionId: effectiveSession,
          openedAt: new Date().toISOString(),
        };
        writeRecentPointer(next);
        return next;
      });
    },
    [],
  );

  const updateStartUnresolved = useCallback(
    (workspaceId: string, unresolved: boolean, pending?: PendingStartReconciliation): void => {
      if (unresolved && pending !== undefined) {
        unresolvedStartWorkspaces.current.set(workspaceId, pending);
      } else if (!unresolved) {
        unresolvedStartWorkspaces.current.delete(workspaceId);
      }
      if (activeWorkspaceId.current === workspaceId) {
        setStartUnresolved(unresolved);
      }
    },
    [],
  );

  const refreshTaskData = useCallback(
    async (
      target: WorkspaceDetail,
      options: { readonly silent: boolean; readonly showError: boolean },
    ): Promise<void> => {
      const requestGeneration = ++taskDataGeneration.current;
      const targetId = target.id;
      const pendingAtRefreshStart = unresolvedStartWorkspaces.current.get(targetId);
      const isCurrent = (): boolean =>
        requestGeneration === taskDataGeneration.current && activeWorkspaceId.current === targetId;
      try {
        target = await collaborationClient.getWorkspace(targetId);
        if (!isCurrent()) return;
        setWorkspace(target);
        const runList = await client.listRuns(targetId);
        if (!isCurrent()) return;
        setRuns(runList);
        setRunsLoaded(true);
        const pending = unresolvedStartWorkspaces.current.get(targetId);
        const accepted = pending === undefined ? null : acceptedRunFrom(runList, pending);
        if (
          pending !== undefined &&
          accepted === null &&
          !options.silent &&
          pending === pendingAtRefreshStart
        ) {
          updateStartUnresolved(targetId, false);
          setCommandError(null);
          setCommandFeedback(null);
        }
        const selected = accepted ?? latestRun(runList);
        if (selected === null) {
          setRun(null);
          if (
            !options.silent &&
            unresolvedStartWorkspaces.current.get(targetId) === pendingAtRefreshStart
          ) {
            updateStartUnresolved(targetId, false);
            setCommandError(null);
            setCommandFeedback(null);
          }
          setTaskError(null);
          setLastSyncedAt(new Date().toISOString());
          setStale(false);
          rememberWorkspace(target, null);
          return;
        }
        const detail = await client.getRun(targetId, selected.id);
        if (!isCurrent()) return;
        setRun(detail);
        addEvents(detail.initialEvents);
        rememberWorkspace(
          target,
          detail.sessionId ??
            detail.conversationId ??
            selected.sessionId ??
            selected.conversationId ??
            null,
        );
        const pendingAfterDetail = unresolvedStartWorkspaces.current.get(targetId);
        const acceptedAfterDetail =
          pendingAfterDetail === undefined ? null : acceptedRunFrom(runList, pendingAfterDetail);
        if (
          (!options.silent && pendingAfterDetail === pendingAtRefreshStart) ||
          pendingAfterDetail === undefined ||
          acceptedAfterDetail?.id === selected.id
        ) {
          updateStartUnresolved(targetId, false);
        }
        setTaskError(null);
        setLastSyncedAt(new Date().toISOString());
        setStale(false);
      } catch (cause) {
        if (!isCurrent()) return;
        setRunsLoaded(false);
        setStale(true);
        if (options.showError) {
          setTaskError(`Task data is unavailable: ${causeMessage(cause)}`);
        }
      }
    },
    [addEvents, client, collaborationClient, rememberWorkspace, updateStartUnresolved],
  );

  const openWorkspace = useCallback(
    async (workspaceId: string, restoring = false): Promise<void> => {
      const requestGeneration = ++navigationGeneration.current;
      taskDataGeneration.current += 1;
      activeWorkspaceId.current = workspaceId;
      setOpenLoading(true);
      setHomeError(null);
      setTaskError(null);
      setEditorOpen(false);
      setPendingStart(null);
      try {
        const detail = await collaborationClient.getWorkspace(workspaceId);
        if (requestGeneration !== navigationGeneration.current) return;
        setWorkspace(detail);
        setView("task");
        setEvents([]);
        lastSequence.current = 0;
        setRuns([]);
        setRun(null);
        setRunsLoaded(false);
        setRunLoading(true);
        setSelectedRunnerId(detail.runnerId ?? "");
        setSelectedProfileId(detail.agentProfileId ?? "");
        setCommandBusy(false);
        setCommandError(null);
        setCommandFeedback(null);
        setStopConfirm(false);
        updateStartUnresolved(workspaceId, unresolvedStartWorkspaces.current.has(workspaceId));
        rememberWorkspace(detail, null);
        await refreshTaskData(detail, { silent: true, showError: true });
      } catch (cause) {
        if (requestGeneration !== navigationGeneration.current) return;
        activeWorkspaceId.current = null;
        taskDataGeneration.current += 1;
        setHomeError(`Personal task could not be opened: ${causeMessage(cause)}`);
        setView("home");
        if (restoring) {
          clearRecentPointer();
          setRecent(null);
        }
      } finally {
        if (requestGeneration === navigationGeneration.current) {
          setOpenLoading(false);
          setRunLoading(false);
        }
      }
    },
    [collaborationClient, refreshTaskData, rememberWorkspace, updateStartUnresolved],
  );

  useEffect(() => {
    let active = true;
    void loadHostEnvironment().then((environment) => {
      if (active) {
        setHost(environment);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refreshHealth();
    const interval = setInterval(() => {
      void refreshHealth();
    }, 15_000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshHealth]);

  useEffect(() => {
    void refreshRunners();
  }, [refreshRunners]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const items = await refreshTasks();
      if (!active || restoreAttempted.current) {
        return;
      }
      const directWorkspaceId = new URLSearchParams(window.location.search).get("workspaceId");
      if (directWorkspaceId !== null && directWorkspaceId.length > 0) {
        restoreAttempted.current = true;
        await openWorkspace(directWorkspaceId, true);
        return;
      }
      const pointer = readRecentPointer();
      if (pointer === null) {
        return;
      }
      if (!items.some((task) => task.id === pointer.workspaceId)) {
        clearRecentPointer();
        setRecent(null);
        return;
      }
      restoreAttempted.current = true;
      await openWorkspace(pointer.workspaceId, true);
    })();
    return () => {
      active = false;
    };
  }, [openWorkspace, refreshTasks]);

  const wasOffline = useRef(false);
  useEffect(() => {
    if (connection === "offline") {
      wasOffline.current = true;
      return;
    }
    if (connection !== "available" && connection !== "degraded") {
      return;
    }
    if (!wasOffline.current) {
      return;
    }
    wasOffline.current = false;
    void (async () => {
      const items = await refreshTasks();
      void refreshRunners();
      if (restoreAttempted.current) {
        return;
      }
      const pointer = readRecentPointer();
      if (pointer === null || !items.some((task) => task.id === pointer.workspaceId)) {
        return;
      }
      restoreAttempted.current = true;
      await openWorkspace(pointer.workspaceId, true);
    })();
  }, [connection, openWorkspace, refreshRunners, refreshTasks]);

  useEffect(() => {
    let active = true;
    if (selectedRunnerId.length === 0) {
      setModelProfiles([]);
      setSelectedProfileId("");
      setProfileError(null);
      setProfileLoading(false);
      return () => {
        active = false;
      };
    }

    setProfileLoading(true);
    setProfileError(null);
    void client
      .listModelProfiles(selectedRunnerId)
      .then((profiles) => {
        if (!active) {
          return;
        }
        const enabled = profiles.filter((profile) => profile.enabled);
        setModelProfiles(enabled);
        setSelectedProfileId((current) => {
          if (enabled.some((profile) => profile.id === current)) {
            return current;
          }
          return enabled[0]?.id ?? "";
        });
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setModelProfiles([]);
        setSelectedProfileId("");
        setProfileError(causeMessage(cause));
        setStale(true);
      })
      .finally(() => {
        if (active) {
          setProfileLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client, selectedRunnerId]);

  const observedWorkspaceId = view === "task" ? (workspace?.id ?? null) : null;
  useEffect(() => {
    const target = workspaceRef.current;
    if (observedWorkspaceId === null || target === null || target.id !== observedWorkspaceId) {
      return;
    }
    let active = true;
    let busy = false;
    const tick = async (): Promise<void> => {
      if (!active || busy) {
        return;
      }
      busy = true;
      try {
        await refreshTaskData(target, { silent: true, showError: false });
      } finally {
        busy = false;
      }
    };
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 4_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refreshTaskData, observedWorkspaceId]);

  useEffect(() => {
    const subscribe = client.subscribeWorkspaceEvents;
    if (observedWorkspaceId === null || subscribe === undefined) {
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const isCurrent = (): boolean => active && activeWorkspaceId.current === observedWorkspaceId;
    try {
      unsubscribe = subscribe(observedWorkspaceId, lastSequence.current, {
        onEvent: (event) => {
          if (!isCurrent()) return;
          addEvents([event]);
          setLastSyncedAt(new Date().toISOString());
          setStale(false);
        },
        onOpen: () => {
          if (!isCurrent()) return;
          setLastSyncedAt(new Date().toISOString());
          setStale(false);
        },
        onError: () => {
          if (isCurrent()) setStale(true);
        },
      });
    } catch (cause) {
      if (isCurrent()) {
        setStale(true);
        setTaskError(`Live timeline is unavailable: ${causeMessage(cause)}`);
      }
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [addEvents, client, observedWorkspaceId]);

  const activeMode: ComposerMode =
    workspace === null ? "start" : (composerModes[workspace.id] ?? "start");
  const activeDraft: string =
    workspace === null ? "" : (composerDrafts[workspace.id]?.[activeMode] ?? "");

  const recentView: RecentTaskView | null = useMemo(() => {
    if (recent === null) {
      return null;
    }
    const task = tasks.find((candidate) => candidate.id === recent.workspaceId);
    if (task === undefined) {
      return null;
    }
    return { task, sessionId: recent.sessionId };
  }, [recent, tasks]);

  const activeRunner = useMemo(() => {
    const runnerId = workspace?.runnerId ?? selectedRunnerId;
    return runners.find((candidate) => candidate.id === runnerId) ?? null;
  }, [runners, selectedRunnerId, workspace?.runnerId]);

  const activeProfile = useMemo(() => {
    const profileId = workspace?.agentProfileId ?? selectedProfileId;
    return modelProfiles.find((candidate) => candidate.id === profileId) ?? null;
  }, [modelProfiles, selectedProfileId, workspace?.agentProfileId]);

  const runnerAvailable = connection === "available" || connection === "degraded";
  const runIsActive = isRunActive(run?.state ?? null);

  const startBlockedReason: string | null = (() => {
    if (startUnresolved) {
      return "The last start request could not be reconciled. Refresh before starting another Run.";
    }
    if (!runsLoaded) {
      return "Checking whether this task already has an active Run…";
    }
    if (runIsActive) {
      return "A Run is already active for this task.";
    }
    if (workspace?.currentOperator === undefined) {
      return "The Runner did not report the operator epoch required to start a Run.";
    }
    if (connection === "offline") {
      return "The Runner is offline. Start is unavailable until it reconnects.";
    }
    return null;
  })();

  const commandBlockedReason: string | null = (() => {
    if (run === null) {
      return "Start a Run before sending steer or follow-up instructions.";
    }
    if (run.state === "stopping") {
      return "The Run is stopping. Wait for the Runner to settle before issuing another command.";
    }
    if (run.operatorEpoch === null) {
      return "The Runner did not report the operator epoch for this Run.";
    }
    if (!isRunActive(run.state)) {
      return "This Run is no longer active. Start a new Run instead.";
    }
    if (connection === "offline") {
      return "The Runner is offline. Commands are unavailable until it reconnects.";
    }
    return null;
  })();

  const canStart =
    view === "task" &&
    workspace !== null &&
    startBlockedReason === null &&
    !commandBusy &&
    !openLoading;
  const canCommand = commandBlockedReason === null && !commandBusy;

  const handleModeChange = useCallback(
    (mode: ComposerMode): void => {
      if (workspace === null) {
        return;
      }
      const workspaceId = workspace.id;
      setComposerModes((current) => ({ ...current, [workspaceId]: mode }));
      setStopConfirm(false);
      setCommandError(null);
    },
    [workspace],
  );

  const handleDraftChange = useCallback(
    (value: string): void => {
      if (workspace === null) {
        return;
      }
      const workspaceId = workspace.id;
      const mode = activeMode;
      setComposerDrafts((current) => {
        const workspaceDrafts = current[workspaceId] ?? EMPTY_DRAFTS;
        return {
          ...current,
          [workspaceId]: { ...workspaceDrafts, [mode]: value },
        };
      });
    },
    [activeMode, workspace],
  );

  const clearDraft = useCallback(
    (mode: ComposerMode): void => {
      if (workspace === null) {
        return;
      }
      const workspaceId = workspace.id;
      setComposerDrafts((current) => {
        const workspaceDrafts = current[workspaceId] ?? EMPTY_DRAFTS;
        return {
          ...current,
          [workspaceId]: { ...workspaceDrafts, [mode]: "" },
        };
      });
    },
    [workspace],
  );

  const handleCreate = useCallback(
    async (input: CreatePersonalTaskInput): Promise<void> => {
      setCreating(true);
      setCreateError(null);
      try {
        const createdResponse = await client.createPersonalTask(input);
        let created = createdResponse;
        if (created.currentOperator === undefined) {
          try {
            created = await client.getPersonalTask(createdResponse.id);
          } catch {
            // The created task is still usable; the Runner may expose the
            // authoritative operator state only after a later refresh.
          }
        }
        navigationGeneration.current += 1;
        taskDataGeneration.current += 1;
        activeWorkspaceId.current = created.id;
        setPendingStart(null);
        setWorkspace(created);
        setView("task");
        setEditorOpen(false);
        setTasks((current) => mergeTaskList(current, created));
        setSelectedRunnerId(created.runnerId ?? input.runnerId);
        setSelectedProfileId(created.agentProfileId ?? input.agentProfileId);
        setRuns([]);
        setRun(null);
        setEvents([]);
        lastSequence.current = 0;
        setRunsLoaded(true);
        setRunLoading(false);
        setTaskError(null);
        setCommandBusy(false);
        updateStartUnresolved(created.id, false);
        setCommandError(null);
        setCommandFeedback(null);
        setStopConfirm(false);
        rememberWorkspace(created, null);
        void refreshTasks();
        void refreshTaskData(created, { silent: true, showError: false });
      } catch (cause) {
        setCreateError(causeMessage(cause));
      } finally {
        setCreating(false);
      }
    },
    [client, refreshTaskData, refreshTasks, rememberWorkspace, updateStartUnresolved],
  );

  const performStart = useCallback(
    async (body: string): Promise<void> => {
      if (workspace === null) {
        return;
      }
      const targetWorkspace = workspace;
      const requestGeneration = navigationGeneration.current;
      const isCurrent = (): boolean =>
        requestGeneration === navigationGeneration.current &&
        activeWorkspaceId.current === targetWorkspace.id;
      const operatorEpoch = targetWorkspace.currentOperator?.operatorEpoch;
      if (operatorEpoch === undefined) {
        setCommandError(
          "Start was not sent because the Runner did not report the current operator epoch.",
        );
        return;
      }
      const previousRunIds = new Set(runs.map((candidate) => candidate.id));
      setCommandBusy(true);
      setCommandError(null);
      setCommandFeedback(null);
      setStopConfirm(false);
      const startInput: StartRunInput = body.trim().length === 0 ? {} : { body: body.trim() };
      let started: RunSummary | null;
      try {
        started = await client.startRun(targetWorkspace.id, startInput, operatorEpoch);
        updateStartUnresolved(targetWorkspace.id, true, {
          previousRunIds,
          acceptedRunId: started?.id ?? null,
        });
        if (!isCurrent()) return;
      } catch (cause) {
        if (isCurrent()) {
          setCommandError(`Start failed: ${causeMessage(cause)}`);
          setCommandBusy(false);
        }
        return;
      }

      setCommandFeedback("Start accepted by the Runner. Waiting for its Run record and events.");
      clearDraft("start");
      if (started !== null) {
        setRun({ ...started, toolCalls: [], initialEvents: [], permitEvents: [] });
        rememberWorkspace(targetWorkspace, started.sessionId ?? started.conversationId ?? null);
      }

      try {
        const runList = await client.listRuns(targetWorkspace.id);
        if (!isCurrent()) return;
        setRuns(runList);
        setRunsLoaded(true);
        const pending = unresolvedStartWorkspaces.current.get(targetWorkspace.id);
        const target =
          started ?? (pending === undefined ? null : acceptedRunFrom(runList, pending));
        if (target === null) {
          updateStartUnresolved(targetWorkspace.id, true);
          setRunsLoaded(false);
          setCommandFeedback(null);
          setCommandError(
            "The Runner accepted the start request but did not return a Run record. Refresh to reconcile before starting another Run.",
          );
          return;
        }
        setRun((current) => {
          if (current !== null && current.id === target.id) {
            return current;
          }
          return { ...target, toolCalls: [], initialEvents: [], permitEvents: [] };
        });
        const detail = await client.getRun(targetWorkspace.id, target.id);
        if (!isCurrent()) return;
        setRun(detail);
        addEvents(detail.initialEvents);
        rememberWorkspace(
          targetWorkspace,
          detail.sessionId ??
            detail.conversationId ??
            target.sessionId ??
            target.conversationId ??
            null,
        );
        updateStartUnresolved(targetWorkspace.id, false);
        setLastSyncedAt(new Date().toISOString());
        setStale(false);
        setPendingStart(null);
      } catch (cause) {
        if (!isCurrent()) return;
        updateStartUnresolved(targetWorkspace.id, true);
        setRunsLoaded(false);
        setTaskError(
          `Start was accepted, but the Run record could not be loaded: ${causeMessage(cause)}`,
        );
      } finally {
        if (isCurrent()) setCommandBusy(false);
      }
    },
    [addEvents, clearDraft, client, rememberWorkspace, runs, updateStartUnresolved, workspace],
  );

  const handleStart = useCallback(
    (body: string): void => {
      if (workspace === null) return;
      setCommandError(null);
      setCommandFeedback(null);
      setPendingStart(body);
    },
    [workspace],
  );

  const handleSteer = useCallback(
    async (body: string): Promise<void> => {
      if (workspace === null || run === null || run.operatorEpoch === null) {
        setCommandError("The Run does not expose an operator epoch for steering.");
        return;
      }
      setCommandBusy(true);
      setCommandError(null);
      setCommandFeedback(null);
      try {
        await client.steerRun(workspace.id, run.id, body, run.operatorEpoch);
        setCommandFeedback("Steer accepted by the Runner. Its effect will appear in the timeline.");
        clearDraft("steer");
        void refreshTaskData(workspace, { silent: true, showError: false });
      } catch (cause) {
        setCommandError(`Steer failed: ${causeMessage(cause)}`);
      } finally {
        setCommandBusy(false);
      }
    },
    [clearDraft, client, refreshTaskData, run, workspace],
  );

  const handleFollowUp = useCallback(
    async (body: string): Promise<void> => {
      if (workspace === null || run === null || run.operatorEpoch === null) {
        setCommandError("The Run does not expose an operator epoch for a follow-up.");
        return;
      }
      setCommandBusy(true);
      setCommandError(null);
      setCommandFeedback(null);
      try {
        await client.queueFollowUp(workspace.id, run.id, body, run.operatorEpoch);
        setCommandFeedback(
          "Follow-up queued by the Runner. It stays withheld until the current instruction settles.",
        );
        clearDraft("follow_up");
        void refreshTaskData(workspace, { silent: true, showError: false });
      } catch (cause) {
        setCommandError(`Follow-up failed: ${causeMessage(cause)}`);
      } finally {
        setCommandBusy(false);
      }
    },
    [clearDraft, client, refreshTaskData, run, workspace],
  );

  const handleConfirmStop = useCallback(async (): Promise<void> => {
    if (workspace === null || run === null || run.operatorEpoch === null) {
      setCommandError("The Run does not expose an operator epoch for stopping.");
      return;
    }
    setCommandBusy(true);
    setCommandError(null);
    setCommandFeedback(null);
    try {
      await client.stopRun(workspace.id, run.id, run.operatorEpoch);
      setStopConfirm(false);
      setCommandFeedback(
        "Stop accepted by the Runner. The final state will appear after the Runner settles the Run.",
      );
      void refreshTaskData(workspace, { silent: true, showError: false });
    } catch (cause) {
      setCommandError(`Stop failed: ${causeMessage(cause)}`);
    } finally {
      setCommandBusy(false);
    }
  }, [client, refreshTaskData, run, workspace]);

  const handleGoHome = useCallback((): void => {
    navigationGeneration.current += 1;
    taskDataGeneration.current += 1;
    activeWorkspaceId.current = null;
    setView("home");
    setEditorOpen(false);
    setTaskError(null);
    setStopConfirm(false);
    setPendingStart(null);
    setCommandBusy(false);
    setOpenLoading(false);
    setRunLoading(false);
    void refreshTasks();
  }, [refreshTasks]);

  const handleRefreshTask = useCallback((): void => {
    if (workspace === null) {
      void Promise.allSettled([refreshHealth(), refreshTasks()]);
      return;
    }
    setRefreshing(true);
    void (async () => {
      await Promise.allSettled([
        refreshHealth(),
        refreshTaskData(workspace, { silent: false, showError: true }),
      ]);
      setRefreshing(false);
    })();
  }, [refreshHealth, refreshTaskData, refreshTasks, workspace]);

  const handleRetryAll = useCallback((): void => {
    setRefreshing(true);
    void (async () => {
      await Promise.allSettled([
        refreshHealth(),
        refreshTasks(),
        refreshRunners(),
        ...(workspace === null
          ? []
          : [refreshTaskData(workspace, { silent: false, showError: true })]),
      ]);
      setRefreshing(false);
    })();
  }, [refreshHealth, refreshRunners, refreshTaskData, refreshTasks, workspace]);

  const connectionLabel =
    connection === "available"
      ? "Available"
      : connection === "degraded"
        ? "Available — degraded"
        : connection === "offline"
          ? "Offline"
          : "Connecting…";
  const showStale = stale || connection === "offline";
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const activeRunnerLabel =
    activeRunner?.name ??
    workspace?.runnerId ??
    (selectedRunnerId.length > 0 ? selectedRunnerId : "Not reported");
  const activeProfileLabel =
    activeProfile === null
      ? (workspace?.agentProfileId ??
        (selectedProfileId.length > 0 ? selectedProfileId : "Not reported"))
      : profileDisplay(activeProfile);

  return (
    <main className="app-shell" data-testid="desktop-root">
      <aside className="app-sidebar" aria-label="Task navigation">
        <header className="app-header">
          <div className="app-header__brand">
            <p className="eyebrow">Personal Agent Workspace</p>
            <h1>Unspool</h1>
          </div>
          <nav className="app-nav" aria-label="Primary">
            <button
              type="button"
              className={view === "home" ? "nav-button nav-button--active" : "nav-button"}
              data-testid="nav-personal-tasks"
              aria-current={view === "home" ? "page" : undefined}
              onClick={handleGoHome}
            >
              Personal tasks
            </button>
          </nav>
        </header>

        <PersonalTaskList
          tasks={tasks}
          recent={recentView}
          selectedWorkspaceId={workspace?.id ?? null}
          query={taskQuery}
          loading={homeLoading}
          error={homeError}
          runnerAvailable={runnerAvailable}
          onQueryChange={setTaskQuery}
          onCreate={() => {
            handleGoHome();
            setCreateError(null);
            setEditorOpen(true);
          }}
          onOpen={(workspaceId) => {
            void openWorkspace(workspaceId);
          }}
          onRefresh={() => {
            void refreshTasks();
          }}
        />
      </aside>

      <div className="workspace-frame">
        <header className="workspace-topbar">
          <div>
            <p className="eyebrow">
              Unspool / {view === "home" ? "Personal tasks" : "Task workspace"}
            </p>
            <span className="workspace-topbar__subtitle">
              Context, execution, and evidence in one place
            </span>
          </div>
          <div className="workspace-topbar__actions">
            <span className={`status-pill status-pill--${connection}`} data-testid="runner-status">
              {connectionLabel}
            </span>
            {view === "task" ? (
              <button
                type="button"
                className="button button--ghost"
                data-testid="workspace-inspector-toggle"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((current) => !current)}
              >
                {inspectorOpen ? "Hide controls" : "Show controls"}
              </button>
            ) : null}
          </div>
        </header>

        <div
          className={
            view === "task" && workspace !== null && inspectorOpen
              ? "workspace-body workspace-body--with-inspector"
              : "workspace-body"
          }
        >
          <div
            className={
              view === "task" && workspace !== null
                ? "conversation-pane conversation-pane--task"
                : "conversation-pane"
            }
            key={view === "home" ? "home" : (workspace?.id ?? "opening-workspace")}
          >
            {host?.mode === "tauri" && host.note !== undefined ? (
              <p className="notice notice--warning" role="alert" data-testid="runner-config-error">
                {host.note}
              </p>
            ) : null}

            {showStale ? (
              <div
                className="stale-banner"
                data-testid="stale-indicator"
                role="status"
                aria-live="polite"
              >
                <div>
                  <strong>Content may be stale.</strong>{" "}
                  {connection === "offline"
                    ? "The local Runner is unreachable. Existing history stays visible, but new commands and approvals are not sent."
                    : "The live timeline reported a connection problem and may be missing recent changes."}{" "}
                  Last confirmed: {formatTimestamp(lastSyncedAt)}.
                  {healthError !== null ? (
                    <span className="stale-banner__detail"> {healthError}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleRetryAll}
                  disabled={refreshing}
                >
                  {refreshing ? "Retrying…" : "Retry now"}
                </button>
              </div>
            ) : null}

            {view === "home" ? (
              <div className="home-layout">
                {editorOpen ? (
                  <PersonalTaskEditor
                    runners={runners}
                    modelProfiles={modelProfiles}
                    selectedRunnerId={selectedRunnerId}
                    selectedProfileId={selectedProfileId}
                    profileLoading={profileLoading}
                    runnersError={runnersError}
                    profileError={profileError}
                    creating={creating}
                    createError={createError}
                    runnerAvailable={runnerAvailable}
                    onRunnerChange={(runnerId) => {
                      setSelectedRunnerId(runnerId);
                      setSelectedProfileId("");
                    }}
                    onProfileChange={setSelectedProfileId}
                    onCreate={(input) => {
                      void handleCreate(input);
                    }}
                    onCancel={() => {
                      setEditorOpen(false);
                      setCreateError(null);
                    }}
                  />
                ) : null}

                {!editorOpen ? (
                  <section className="welcome-card" aria-labelledby="welcome-title">
                    <p className="eyebrow">Your private workspace</p>
                    <h2 id="welcome-title">What would you like to work on?</h2>
                    <p>
                      Start with a focused task. Every Run keeps its context, approvals, and
                      evidence attached, so people can decide what the Agent may do next.
                    </p>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => {
                        setCreateError(null);
                        setEditorOpen(true);
                      }}
                    >
                      Create a personal task
                    </button>
                    <ul className="welcome-capabilities" aria-label="Why Unspool">
                      <li>
                        <strong>Direct with context</strong>
                        <span>Steer an active Run without losing its goal or history.</span>
                      </li>
                      <li>
                        <strong>Approve with boundaries</strong>
                        <span>Keep sensitive tools behind explicit operator decisions.</span>
                      </li>
                      <li>
                        <strong>Hand off with evidence</strong>
                        <span>Carry sources, conclusions, and artifacts into what comes next.</span>
                      </li>
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : workspace === null ? (
              <section className="panel" aria-live="polite">
                <p className="status-text">
                  {openLoading ? "Opening personal task…" : "No task is open."}
                </p>
                <button type="button" className="button button--ghost" onClick={handleGoHome}>
                  Back to personal tasks
                </button>
              </section>
            ) : (
              <section className="task-view" aria-labelledby="workspace-title">
                <div className="task-view__header">
                  <div>
                    <p className="eyebrow">Personal task</p>
                    <h2 id="workspace-title" data-testid="workspace-title">
                      {workspace.name}
                    </h2>
                    <p className="task-view__goal">
                      {workspace.goal === undefined || workspace.goal.trim().length === 0
                        ? "No goal recorded for this task."
                        : workspace.goal}
                    </p>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={handleRefreshTask}
                      disabled={refreshing || openLoading}
                    >
                      {refreshing ? "Refreshing…" : "Refresh task"}
                    </button>
                  </div>
                </div>

                {workspace.currentOperator === undefined ? (
                  <p className="notice notice--warning" role="status">
                    The Runner has not reported the current operator epoch. Starting or steering
                    this task remains disabled until the authoritative state is available.
                  </p>
                ) : null}
                {runLoading ? (
                  <p className="status-text" role="status">
                    Checking the task for an existing Run…
                  </p>
                ) : null}

                <div className="task-grid">
                  <RunTimeline
                    run={run}
                    events={events}
                    stale={stale}
                    lastSyncedAt={lastSyncedAt}
                    error={taskError}
                    refreshing={refreshing || openLoading || runLoading}
                    onRefresh={handleRefreshTask}
                  />
                  <RunComposer
                    mode={activeMode}
                    draft={activeDraft}
                    run={run}
                    canStart={canStart}
                    canCommand={canCommand}
                    startBlockedReason={startBlockedReason}
                    commandBlockedReason={commandBlockedReason}
                    busy={commandBusy}
                    error={commandError}
                    feedback={commandFeedback}
                    stopConfirm={stopConfirm}
                    onModeChange={handleModeChange}
                    onDraftChange={handleDraftChange}
                    onStart={(body) => {
                      void handleStart(body);
                    }}
                    onSteer={(body) => {
                      void handleSteer(body);
                    }}
                    onFollowUp={(body) => {
                      void handleFollowUp(body);
                    }}
                    onRequestStop={() => {
                      setCommandError(null);
                      setStopConfirm(true);
                    }}
                    onCancelStop={() => setStopConfirm(false)}
                    onConfirmStop={() => {
                      void handleConfirmStop();
                    }}
                  />
                </div>

                {pendingStart !== null ? (
                  <StartRunDisclosure
                    client={collaborationClient}
                    workspace={workspace}
                    runner={activeRunner}
                    profile={activeProfile}
                    busy={commandBusy}
                    canConfirm={canStart}
                    error={commandError ?? taskError}
                    onCancel={() => setPendingStart(null)}
                    onConfirm={() => {
                      void performStart(pendingStart);
                    }}
                  />
                ) : null}
              </section>
            )}
          </div>

          {view === "task" && workspace !== null && inspectorOpen ? (
            <aside className="workspace-inspector" aria-label="Workspace controls">
              <section className="inspector-intro" aria-labelledby="inspector-title">
                <p className="eyebrow">Unspool control plane</p>
                <h2 id="inspector-title">You decide what happens next.</h2>
                <p>
                  Direct the Agent, approve sensitive actions, and carry traceable evidence into the
                  next conversation or handoff.
                </p>
                <ul className="capability-list" aria-label="Unspool capabilities">
                  <li>Scoped context</li>
                  <li>Human approvals</li>
                  <li>Evidence & handoffs</li>
                </ul>
              </section>

              <details className="panel inspector-details" open>
                <summary>Run and workspace details</summary>
                <dl className="workspace-meta">
                  <div>
                    <dt>Workspace</dt>
                    <dd data-testid="workspace-id">{workspace.id}</dd>
                  </div>
                  <div>
                    <dt>Kind</dt>
                    <dd data-testid="workspace-kind">{workspace.kind}</dd>
                  </div>
                  {workspace.kind === "shared" && workspace.teamId !== undefined ? (
                    <div>
                      <dt>Team</dt>
                      <dd data-testid="workspace-team-id">{workspace.teamId}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Runner</dt>
                    <dd data-testid="selected-runner">{activeRunnerLabel}</dd>
                  </div>
                  <div>
                    <dt>Model profile</dt>
                    <dd data-testid="selected-model-profile">{activeProfileLabel}</dd>
                  </div>
                  <div>
                    <dt>Operator epoch</dt>
                    <dd>{workspace.currentOperator?.operatorEpoch ?? "Not reported"}</dd>
                  </div>
                  <div>
                    <dt>Run records</dt>
                    <dd>{runs.length === 0 ? "None yet" : `${String(runs.length)} recorded`}</dd>
                  </div>
                </dl>
              </details>

              {workspace.kind === "shared" ? (
                <>
                  <WorkspaceOverview
                    client={collaborationClient}
                    artifactClient={client}
                    workspaceId={workspace.id}
                    refreshToken={
                      events.length +
                      (workspace.currentOperator?.operatorEpoch ?? 0) +
                      (workspace.revision ?? 0)
                    }
                  />
                  <ModeComposer
                    client={collaborationClient}
                    workspaceId={workspace.id}
                    permissions={{
                      canDiscuss: true,
                      canSuggest: true,
                      canDirectInstruction: true,
                      canDecideSuggestions: true,
                    }}
                  />
                </>
              ) : null}

              <ContextEditor client={collaborationClient} workspaceId={workspace.id} />

              <div className="task-grid task-grid--secondary">
                <ApprovalCenter
                  client={client}
                  workspaceId={workspace.id}
                  currentOperatorId={workspace.currentOperator?.operatorId}
                  refreshToken={events.length + runs.length}
                  onDecision={() => {
                    void refreshTaskData(workspace, { silent: false, showError: true });
                  }}
                />
                <ArtifactPanel
                  client={client}
                  workspaceId={workspace.id}
                  runId={run?.id}
                  refreshToken={runs.length + events.length}
                  maxUploadBytes={health?.maxUploadBytes}
                />
              </div>

              <WorkspaceWorkflow
                workspace={workspace}
                run={run}
                events={events}
                collaboration={collaborationClient}
                workflow={workflowClient}
                artifactClient={client}
                onOpenWorkspace={(workspaceId) => openWorkspace(workspaceId, true)}
              />

              <details className="panel runner-settings-disclosure">
                <summary>Runner and personal settings</summary>
                <RunnerSettings
                  client={client}
                  selectedRunnerId={selectedRunnerId}
                  selectedModelProfileId={selectedProfileId}
                  refreshToken={runners.length + modelProfiles.length}
                  onSelectionChange={(selection) => {
                    setSelectedRunnerId(selection.runnerId);
                    setSelectedProfileId(selection.modelProfileId);
                  }}
                />
              </details>
            </aside>
          ) : null}
        </div>

        <footer className="app-footer">
          <span>Local-first personal workspace</span>
          {host !== null && host.mode === "browser" ? (
            <span className="app-footer__connection" data-testid="browser-runner-mode">
              Browser API · <code>{client.baseUrl}</code>
            </span>
          ) : (
            <span>Desktop host</span>
          )}
          <span>
            {health?.service ?? "Runner API"} ·{" "}
            {health?.supportState ?? "support state not reported"}
          </span>
        </footer>
      </div>
    </main>
  );
}
