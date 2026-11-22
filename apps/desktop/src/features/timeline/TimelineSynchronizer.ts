import { useCallback, useEffect, useRef, useState } from "react";
import type { CollaborationClient } from "../../api/collaborationTypes";
import type { TimelineEvent } from "../../api/types";

export type TimelineSyncStatus = "idle" | "connecting" | "live" | "reconnecting" | "offline";

export interface TimelineSynchronizerOptions {
  readonly client: Pick<CollaborationClient, "subscribeWorkspaceEvents">;
  readonly workspaceId: string | null;
  readonly enabled?: boolean | undefined;
  readonly initialEvents?: readonly TimelineEvent[] | undefined;
  readonly initialLastSequence?: number | undefined;
  readonly reconnectDelayMs?: number | undefined;
  readonly maxEvents?: number | undefined;
}

export interface TimelineSynchronizerResult {
  readonly events: readonly TimelineEvent[];
  readonly status: TimelineSyncStatus;
  readonly stale: boolean;
  readonly lastSequence: number;
  readonly unreadCount: number;
  readonly unreadEventIds: ReadonlySet<string>;
  readonly error: string | null;
  readonly lastEventAt: string | null;
  readonly lastOpenedAt: string | null;
  readonly markRead: () => void;
  readonly reconnect: () => void;
}

const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function compareEvents(left: TimelineEvent, right: TimelineEvent): number {
  return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
}

function capEvents(events: readonly TimelineEvent[], limit: number): readonly TimelineEvent[] {
  return events.length <= limit ? events : events.slice(events.length - limit);
}

/**
 * Maintains one workspace's live timeline for one client.
 *
 * Reconnection always resumes from the highest sequence actually received, so
 * replayed events from the Runner are ignored by both sequence and event id.
 * A page reload or a second client starts from its own persisted sequence and
 * converges on the same workspace events without sharing local unread state.
 */
export function useTimelineSynchronizer({
  client,
  workspaceId,
  enabled = true,
  initialEvents,
  initialLastSequence = 0,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  maxEvents = DEFAULT_MAX_EVENTS,
}: TimelineSynchronizerOptions): TimelineSynchronizerResult {
  const eventLimit = Math.max(1, Math.floor(maxEvents));
  const baseReconnectDelay = Math.max(100, Math.floor(reconnectDelayMs));
  const lastSequenceRef = useRef(initialLastSequence);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const resetKeyRef = useRef<string | null>(null);

  const [events, setEvents] = useState<readonly TimelineEvent[]>(() => initialEvents ?? []);
  const [status, setStatus] = useState<TimelineSyncStatus>(
    workspaceId === null ? "idle" : "connecting",
  );
  const [lastSequence, setLastSequence] = useState(initialLastSequence);
  const [unreadIds, setUnreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [lastOpenedAt, setLastOpenedAt] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const markRead = useCallback(() => {
    setUnreadIds(new Set());
  }, []);

  const reconnect = useCallback(() => {
    setReconnectNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (resetKeyRef.current === workspaceId) {
      return;
    }
    resetKeyRef.current = workspaceId;
    const seed = initialEvents ?? [];
    const seen = new Set(seed.map((event) => event.id));
    const sequence = seed.reduce(
      (maximum, event) => Math.max(maximum, event.sequence ?? 0),
      initialLastSequence,
    );
    lastSequenceRef.current = sequence;
    seenIdsRef.current = seen;
    setEvents(seed);
    setLastSequence(sequence);
    setUnreadIds(new Set());
    setError(null);
    setLastEventAt(null);
    setLastOpenedAt(null);
    setStatus(workspaceId === null ? "idle" : "connecting");
  }, [initialEvents, initialLastSequence, workspaceId]);

  useEffect(() => {
    if (initialEvents === undefined || initialEvents.length === 0) {
      return;
    }
    const fresh: TimelineEvent[] = [];
    let sequence = lastSequenceRef.current;
    for (const event of initialEvents) {
      if (seenIdsRef.current.has(event.id)) {
        continue;
      }
      seenIdsRef.current.add(event.id);
      fresh.push(event);
      if (event.sequence !== undefined) {
        sequence = Math.max(sequence, event.sequence);
      }
    }
    if (sequence !== lastSequenceRef.current) {
      lastSequenceRef.current = sequence;
      setLastSequence(sequence);
    }
    if (fresh.length === 0) {
      return;
    }
    setEvents((current) => capEvents([...current, ...fresh].sort(compareEvents), eventLimit));
  }, [eventLimit, initialEvents]);

  useEffect(() => {
    void reconnectNonce;
    if (workspaceId === null || !enabled) {
      setStatus("idle");
      setError(null);
      return;
    }
    const targetWorkspaceId = workspaceId;

    let active = true;
    let unsubscribe: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    function scheduleReconnect(message: string): void {
      if (!active || retryTimer !== null) {
        return;
      }
      retries += 1;
      setError(message);
      setStatus(retries >= 3 ? "offline" : "reconnecting");
      const delay = Math.min(
        baseReconnectDelay * 2 ** Math.min(retries - 1, 5),
        MAX_RECONNECT_DELAY_MS,
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    }

    function connect(): void {
      if (!active) {
        return;
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
      setStatus(retries === 0 ? "connecting" : "reconnecting");
      try {
        unsubscribe = client.subscribeWorkspaceEvents(targetWorkspaceId, lastSequenceRef.current, {
          onEvent: (event) => {
            if (!active) {
              return;
            }
            if (seenIdsRef.current.has(event.id)) {
              return;
            }
            if (event.sequence !== undefined && event.sequence <= lastSequenceRef.current) {
              seenIdsRef.current.add(event.id);
              return;
            }

            seenIdsRef.current.add(event.id);
            if (event.sequence !== undefined) {
              lastSequenceRef.current = Math.max(lastSequenceRef.current, event.sequence);
              setLastSequence(lastSequenceRef.current);
            }
            setEvents((current) => {
              if (current.some((candidate) => candidate.id === event.id)) {
                return current;
              }
              return capEvents([...current, event].sort(compareEvents), eventLimit);
            });
            setUnreadIds((current) => {
              if (current.has(event.id)) {
                return current;
              }
              const next = new Set(current);
              next.add(event.id);
              return next;
            });
            setLastEventAt(new Date().toISOString());
            setError(null);
            setStatus("live");
          },
          onOpen: () => {
            if (!active) {
              return;
            }
            retries = 0;
            setStatus("live");
            setError(null);
            setLastOpenedAt(new Date().toISOString());
          },
          onError: () => {
            if (!active) {
              return;
            }
            if (unsubscribe !== null) {
              unsubscribe();
              unsubscribe = null;
            }
            scheduleReconnect(
              "Live synchronization was interrupted. Reconnecting from the last received sequence; changes may be missing until it recovers.",
            );
          },
        });
      } catch (cause) {
        scheduleReconnect(
          `Live synchronization could not start: ${errorMessage(cause)}. Retrying with the last received sequence.`,
        );
      }
    }

    connect();

    return () => {
      active = false;
      if (unsubscribe !== null) {
        unsubscribe();
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
  }, [baseReconnectDelay, client, enabled, eventLimit, reconnectNonce, workspaceId]);

  return {
    events,
    status,
    stale: status === "reconnecting" || status === "offline",
    lastSequence,
    unreadCount: unreadIds.size,
    unreadEventIds: unreadIds,
    error,
    lastEventAt,
    lastOpenedAt,
    markRead,
    reconnect,
  };
}
