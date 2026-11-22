import { useId, useState } from "react";
import { KeyboardShortcuts } from "../../accessibility/KeyboardShortcuts";
import { toolKindForName } from "../../api/runnerClient";
import type { RunDetail, TimelineEvent, ToolCallView } from "../../api/types";
import { runStateLabel } from "./runState";
import { UnknownOutcomePanel } from "./UnknownOutcomePanel";

interface RunTimelineProps {
  readonly run: RunDetail | null;
  readonly events: readonly TimelineEvent[];
  readonly stale: boolean;
  readonly lastSyncedAt: string | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function readText(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function payloadOutput(payload: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of [
    "output",
    "delta",
    "message",
    "text",
    "summary",
    "detail",
    "error",
    "reason",
  ]) {
    const value = readText(payload, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function eventText(event: TimelineEvent): string {
  const direct = payloadOutput(event.payload);
  if (direct !== undefined) {
    return direct;
  }
  if (Object.keys(event.payload).length === 0) {
    return "";
  }
  return safeStringify(event.payload);
}

function eventLabel(type: string): string {
  const words = type.replaceAll(".", " ").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function eventTime(value: string | undefined): string {
  if (value === undefined) {
    return "Time not reported";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(parsed));
}

function isCriticalEvent(event: TimelineEvent): boolean {
  return (
    event.type.includes("failed") ||
    event.type.includes("error") ||
    event.type.includes("needs_confirmation") ||
    event.type.includes("invalidated") ||
    event.type.includes("expired") ||
    event.type.includes("missing") ||
    event.type.includes("receipt_gap")
  );
}

function toolStateForEvent(eventType: string, payload: Readonly<Record<string, unknown>>): string {
  const reported = readText(payload, "state")?.toLowerCase();
  if (eventType === "tool.preflight") {
    return reported ?? "preflight";
  }
  if (eventType === "tool.execution_entered") {
    return "running";
  }
  if (eventType === "tool.progress") {
    return "running";
  }
  if (eventType === "tool.receipt_gap") {
    return "unknown";
  }
  if (eventType === "tool.finalized") {
    if (reported !== undefined) {
      return reported;
    }
    const result = readText(payload, "result")?.toLowerCase();
    if (result === "success" || result === "succeeded" || result === "complete") {
      return "succeeded";
    }
    if (result === "failure" || result === "failed" || result === "error") {
      return "failed";
    }
    return "finalized";
  }
  return reported ?? eventType.replace("tool.", "");
}

function mergeToolEvent(tools: Map<string, ToolCallView>, event: TimelineEvent): void {
  const payload = event.payload;
  const toolName =
    readText(payload, "toolName") ?? readText(payload, "name") ?? readText(payload, "tool");
  const toolCallId = readText(payload, "toolCallId") ?? readText(payload, "callId");
  const approvalRequested = event.type === "approval.requested";
  if (
    !event.type.startsWith("tool.") &&
    !(approvalRequested && (toolName !== undefined || toolCallId !== undefined))
  ) {
    return;
  }

  const key = toolCallId ?? toolName;
  if (key === undefined) {
    return;
  }
  const existing = tools.get(key);
  const nextName = toolName ?? existing?.toolName ?? "unknown-tool";
  const nextState = approvalRequested
    ? "awaiting_approval"
    : toolStateForEvent(event.type, payload);
  const approvalRequired =
    (existing?.approvalRequired ?? false) ||
    payload.approvalRequired === true ||
    payload.requiresApproval === true ||
    approvalRequested;
  const output = payloadOutput(payload);
  const occurredAt = event.occurredAt;
  const displayArgs =
    payload.displayArgs ?? payload.effectiveArgs ?? payload.args ?? existing?.displayArgs;
  const outputValue =
    existing?.output !== undefined && output !== undefined && event.type === "tool.progress"
      ? `${existing.output}${output}`
      : (output ?? existing?.output);
  const merged: ToolCallView = {
    id: existing?.id ?? event.id,
    toolCallId: toolCallId ?? existing?.toolCallId ?? key,
    toolName: nextName,
    kind: toolKindForName(nextName),
    state: nextState,
    approvalRequired,
    ...(displayArgs === undefined ? {} : { displayArgs }),
    ...(outputValue === undefined ? {} : { output: outputValue }),
    ...(existing?.startedAt === undefined && occurredAt === undefined
      ? {}
      : { startedAt: existing?.startedAt ?? occurredAt }),
    ...(occurredAt === undefined ? {} : { updatedAt: occurredAt }),
  };
  tools.set(key, merged);
}

function collectEventModel(
  run: RunDetail | null,
  liveEvents: readonly TimelineEvent[],
): {
  readonly events: readonly TimelineEvent[];
  readonly tools: readonly ToolCallView[];
  readonly permits: readonly TimelineEvent[];
} {
  const eventMap = new Map<string, TimelineEvent>();
  if (run !== null) {
    for (const event of [...run.initialEvents, ...run.permitEvents]) {
      eventMap.set(event.id, event);
    }
  }
  for (const event of liveEvents) {
    eventMap.set(event.id, event);
  }
  const events = [...eventMap.values()].sort((left, right) => {
    const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
    return leftSequence - rightSequence;
  });

  const toolMap = new Map<string, ToolCallView>();
  if (run !== null) {
    for (const tool of run.toolCalls) {
      toolMap.set(tool.toolCallId, tool);
    }
  }
  for (const event of events) {
    mergeToolEvent(toolMap, event);
  }

  return {
    events,
    tools: [...toolMap.values()],
    permits: events.filter((event) => event.type === "approval.permit_consumed"),
  };
}

function CollapsibleOutput({ text, label }: { readonly text: string; readonly label: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 900 || text.split("\n").length > 12;
  return (
    <div className="output">
      <pre className={long && !expanded ? "output__pre output__pre--clamped" : "output__pre"}>
        {text}
      </pre>
      {long ? (
        <button
          type="button"
          className="button button--link"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? `Collapse ${label}` : `Show full ${label}`}
        </button>
      ) : null}
    </div>
  );
}

export function RunTimeline({
  run,
  events,
  stale,
  lastSyncedAt,
  error,
  refreshing,
  onRefresh,
}: RunTimelineProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const model = collectEventModel(run, events);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleEvents =
    normalizedQuery.length === 0
      ? model.events
      : model.events.filter((event) => {
          const haystack = `${event.type} ${eventText(event)}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        });

  return (
    <section className="panel timeline" data-testid="run-timeline" aria-labelledby="timeline-title">
      <KeyboardShortcuts onSubmit={onRefresh} onCancel={() => setQuery("")} />
      <div className="panel__header">
        <div>
          <p className="eyebrow">Execution</p>
          <h2 id="timeline-title">Run timeline</h2>
          <p className="sr-only">
            Agent output, tool activity, approvals, permits, and Run state stay visible here.
          </p>
        </div>
        <div className="button-row">
          {stale ? <span className="tag tag--warning">Content may be stale</span> : null}
          <button
            type="button"
            className="button button--ghost"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh timeline"}
          </button>
        </div>
      </div>

      {run === null ? (
        <div className="empty-state">
          <p>No Run has been recorded for this task yet. Start a Run from the composer.</p>
        </div>
      ) : (
        <>
          <dl className="run-metrics">
            <div>
              <dt>State</dt>
              <dd data-testid="run-state">{run.state}</dd>
            </div>
            <div>
              <dt>Run ID</dt>
              <dd data-testid="run-id">{run.id}</dd>
            </div>
            <div>
              <dt>Session ID</dt>
              <dd data-testid="session-id">
                {run.sessionId ?? run.conversationId ?? "Not reported by Runner"}
              </dd>
            </div>
            <div>
              <dt>State detail</dt>
              <dd>{runStateLabel(run.state)}</dd>
            </div>
          </dl>

          <p className="timeline__sync" role="status">
            {lastSyncedAt === null
              ? "No successful synchronization yet."
              : `Last synchronized ${new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(lastSyncedAt))}.`}
            {stale ? " Changes may be missing until the connection recovers." : ""}
          </p>

          {run.state === "failed" ? (
            <p className="notice notice--error" role="alert">
              The Run failed. Review the last events and decide the next step; a failed Run is not a
              completed task.
            </p>
          ) : null}
          {run.state === "needs_confirmation" ? (
            <UnknownOutcomePanel
              lastKnownCheckpoint={run.lastKnownCheckpoint}
              unknownReason={run.unknownReason}
              onRefresh={onRefresh}
            />
          ) : null}
          {run.state === "waiting_approval" ? (
            <p className="notice notice--warning" role="status">
              The Run is waiting for an approval decision. Tool effects must not be treated as
              executed until their permit is consumed.
            </p>
          ) : null}
          {run.unknownReason !== undefined ? (
            <p className="notice notice--warning" role="alert">
              Runner note: {run.unknownReason}
            </p>
          ) : null}

          {model.permits.length > 0 ? (
            <section className="permit" aria-label="Execution permits">
              <p className="permit__summary" data-testid="permit-consumed">
                Permit consumed: {model.permits.length} approved action
                {model.permits.length === 1 ? "" : "s"} reached execution.
              </p>
              <ul className="permit__events">
                {model.permits.map((permit) => (
                  <li
                    key={permit.id}
                    data-testid="permit-event"
                    data-event-type={permit.type}
                    className="permit__event"
                  >
                    <span>{permit.type}</span>
                    <time>{eventTime(permit.occurredAt)}</time>
                    <span>{safeStringify(permit.payload)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {model.tools.length > 0 ? (
            <div className="timeline__section">
              <h3>Tools</h3>
              <ul className="tool-list">
                {model.tools.map((tool) => (
                  <li
                    key={tool.toolCallId}
                    className="tool-call"
                    data-testid="tool-call"
                    data-tool-kind={tool.kind}
                    data-approval-required={tool.approvalRequired ? "true" : "false"}
                    data-state={tool.state}
                  >
                    <div className="tool-call__header">
                      <strong>{tool.toolName}</strong>
                      <span className="tag">{tool.kind}</span>
                      <span className="tag">{tool.state}</span>
                      <span className={tool.approvalRequired ? "tag tag--warning" : "tag"}>
                        {tool.approvalRequired ? "Approval required" : "No approval required"}
                      </span>
                    </div>
                    {tool.displayArgs !== undefined ? (
                      <CollapsibleOutput text={safeStringify(tool.displayArgs)} label="arguments" />
                    ) : null}
                    {tool.output !== undefined ? (
                      <CollapsibleOutput text={tool.output} label="tool output" />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="timeline__section">
            <div className="timeline__filter">
              <label htmlFor={searchId}>Filter timeline</label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search event text or type"
              />
            </div>
            <p className="field__hint">
              Filtering hides non-matching history. Tool records and permit consumption above stay
              visible so risky activity is not silently removed by a search.
            </p>

            {model.events.length === 0 ? (
              <div className="empty-state">
                <p>
                  No events have arrived yet. The Runner may still be preparing the Run; refresh or
                  wait for the live stream.
                </p>
              </div>
            ) : null}

            {model.events.length > 0 && visibleEvents.length === 0 ? (
              <div className="empty-state">
                <p>No timeline event matches this filter.</p>
              </div>
            ) : null}

            {visibleEvents.length > 0 ? (
              <ol className="timeline__events" aria-live="polite">
                {visibleEvents.map((event) => {
                  const text = eventText(event);
                  return (
                    <li
                      key={event.id}
                      className={
                        isCriticalEvent(event)
                          ? "timeline__event timeline__event--critical"
                          : "timeline__event"
                      }
                    >
                      <div className="timeline__event-header">
                        <span className="tag">{eventLabel(event.type)}</span>
                        <time dateTime={event.occurredAt}>{eventTime(event.occurredAt)}</time>
                        {event.actor?.displayNameAtTime !== undefined ? (
                          <span>{event.actor.displayNameAtTime}</span>
                        ) : null}
                      </div>
                      <p className="timeline__event-type">{event.type}</p>
                      {text.length > 0 ? (
                        <CollapsibleOutput text={text} label="event output" />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
        </>
      )}

      {error !== null ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
