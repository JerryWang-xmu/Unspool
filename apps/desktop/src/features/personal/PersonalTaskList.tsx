import { useId } from "react";
import type { PersonalTaskSummary } from "../../api/types";

export interface RecentTaskView {
  readonly task: PersonalTaskSummary;
  readonly sessionId: string | null;
}

interface PersonalTaskListProps {
  readonly tasks: readonly PersonalTaskSummary[];
  readonly recent: RecentTaskView | null;
  readonly selectedWorkspaceId: string | null;
  readonly query: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly runnerAvailable: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onOpen: (workspaceId: string) => void;
  readonly onRefresh: () => void;
}

function taskTimestamp(task: PersonalTaskSummary): number {
  if (task.updatedAt === undefined) {
    return 0;
  }
  const parsed = Date.parse(task.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statusLabel(task: PersonalTaskSummary): string {
  switch (task.status) {
    case "active":
      return "Active";
    case "archived":
      return "Archived";
    case "draft":
      return "Draft";
    default:
      return "Status unknown";
  }
}

function formatUpdatedAt(value: string | undefined): string {
  if (value === undefined) {
    return "Update time not reported";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export function PersonalTaskList({
  tasks,
  recent,
  selectedWorkspaceId,
  query,
  loading,
  error,
  runnerAvailable,
  onQueryChange,
  onCreate,
  onOpen,
  onRefresh,
}: PersonalTaskListProps) {
  const searchId = useId();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTasks = [...tasks]
    .filter((task) => {
      if (normalizedQuery.length === 0) {
        return true;
      }
      return (
        task.name.toLowerCase().includes(normalizedQuery) ||
        (task.goal ?? "").toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left));

  return (
    <section
      className="panel task-list"
      data-testid="personal-task-list"
      aria-labelledby="tasks-title"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Personal history</p>
          <h2 id="tasks-title">Personal tasks</h2>
          <p className="panel__hint">
            Personal mode only. No Team, invitation, sharing, or federation setup is required.
          </p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button button--ghost"
            onClick={onRefresh}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="button button--primary"
            data-testid="new-personal-task"
            onClick={onCreate}
          >
            New task
          </button>
        </div>
      </div>

      {!runnerAvailable ? (
        <p className="notice notice--warning" role="status">
          The local Runner is not currently available. You can review history, but creation and Run
          actions stay disabled until the Runner reconnects.
        </p>
      ) : null}

      {recent !== null ? (
        <div className="recent">
          <p className="eyebrow">Recent task</p>
          <button
            type="button"
            className="recent__card"
            data-testid="recent-task"
            data-workspace-id={recent.task.id}
            data-session-id={recent.sessionId ?? ""}
            onClick={() => onOpen(recent.task.id)}
          >
            <span className="recent__name">{recent.task.name}</span>
            <span className="recent__meta">
              {recent.sessionId === null
                ? "No Run session recorded yet"
                : `Session ${recent.sessionId}`}
            </span>
            <span className="recent__meta">{formatUpdatedAt(recent.task.updatedAt)}</span>
          </button>
        </div>
      ) : null}

      <div className="task-list__search">
        <label htmlFor={searchId}>Search personal tasks</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search by task name or goal"
          autoComplete="off"
        />
      </div>

      {error !== null ? (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button type="button" className="button button--ghost" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : null}

      {loading && tasks.length === 0 ? (
        <p className="status-text" role="status">
          Loading personal task history…
        </p>
      ) : null}

      {!loading && visibleTasks.length === 0 ? (
        <div className="empty-state">
          <p>
            {tasks.length === 0
              ? "No personal tasks yet. Create one to start a tool-bearing Agent run."
              : "No personal task matches this search."}
          </p>
        </div>
      ) : null}

      {visibleTasks.length > 0 ? (
        <ul className="task-list__items">
          {visibleTasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="task-list__item"
                data-testid="personal-task-item"
                data-workspace-id={task.id}
                aria-current={selectedWorkspaceId === task.id ? "true" : undefined}
                onClick={() => onOpen(task.id)}
              >
                <span className="task-list__item-heading">
                  <span className="task-list__item-name">{task.name}</span>
                  <span className={`tag tag--${task.status}`}>{statusLabel(task)}</span>
                </span>
                <span className="task-list__item-goal">
                  {task.goal === undefined || task.goal.trim().length === 0
                    ? "No goal recorded"
                    : task.goal}
                </span>
                <span className="task-list__item-meta">{formatUpdatedAt(task.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
