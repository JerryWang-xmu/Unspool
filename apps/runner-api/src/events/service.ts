/**
 * Ordered projection and keyset replay for committed DomainEvents.
 *
 * Both the persisted row (`id`) and the realtime envelope (`eventId`) are
 * accepted as the event identity. Replay always scans in `sequence` order and
 * advances the cursor past hidden events, so a subscriber that may not see a
 * record still moves through the workspace timeline without learning its
 * contents.
 */

export const DEFAULT_EVENT_PAGE_LIMIT = 50;
export const MAX_EVENT_PAGE_LIMIT = 200;

export interface CommittedEvent {
  readonly workspaceId: string;
  readonly sequence: number;
  readonly type: string;
  readonly eventId?: string;
  readonly id?: string;
}

export interface EventReplayInput<TEvent extends CommittedEvent> {
  readonly events: readonly TEvent[];
  readonly afterSequence?: number;
  readonly limit?: number;
  /**
   * Event-level read decision. Pass the existing visibility policy's
   * `canRead` here; denied events are skipped without being serialized.
   */
  readonly canRead?: (event: TEvent) => boolean;
}

export interface EventReplayPage<TEvent extends CommittedEvent> {
  readonly events: readonly TEvent[];
  readonly nextSequence: number;
  readonly hasMore: boolean;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

function assertCommittedEvent(event: CommittedEvent): void {
  if (typeof event.workspaceId !== "string" || event.workspaceId.length === 0) {
    throw new TypeError("Committed DomainEvent workspaceId must be a non-empty string.");
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
    throw new TypeError("Committed DomainEvent sequence must be a positive safe integer.");
  }
  if (typeof event.type !== "string" || event.type.length === 0) {
    throw new TypeError("Committed DomainEvent type must be a non-empty string.");
  }
}

function eventIdentity(event: CommittedEvent): string | null {
  if (typeof event.eventId === "string" && event.eventId.length > 0) {
    return `event:${event.eventId}`;
  }
  if (typeof event.id === "string" && event.id.length > 0) {
    return `id:${event.id}`;
  }
  return null;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_EVENT_PAGE_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("limit must be a positive safe integer.");
  }
  return Math.min(limit, MAX_EVENT_PAGE_LIMIT);
}

/**
 * Returns the committed timeline as a stable, gap-preserving sequence.
 * Duplicate event identities and duplicate workspace sequences are projected
 * once, which keeps `eventId` idempotency and `(workspaceId, sequence)`
 * uniqueness intact at the API boundary.
 */
export function projectCommittedEvents<TEvent extends CommittedEvent>(
  events: readonly TEvent[],
): readonly TEvent[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const seenIdentities = new Set<string>();
  const seenSequences = new Set<number>();
  const projected: TEvent[] = [];

  for (const event of ordered) {
    assertCommittedEvent(event);

    const identity = eventIdentity(event);
    if (identity !== null) {
      if (seenIdentities.has(identity)) {
        continue;
      }
      seenIdentities.add(identity);
    }

    if (seenSequences.has(event.sequence)) {
      continue;
    }
    seenSequences.add(event.sequence);
    projected.push(event);
  }

  return projected;
}

/**
 * Replays one keyset page after `afterSequence`.
 *
 * `limit` bounds the number of committed events examined, not the number of
 * visible events returned. Hidden events therefore consume their place in the
 * page: the caller can advance past the gap without the hidden payload ever
 * appearing in the response.
 */
export function replayEvents<TEvent extends CommittedEvent>(
  input: EventReplayInput<TEvent>,
): EventReplayPage<TEvent> {
  const afterSequence = input.afterSequence ?? 0;
  assertNonNegativeInteger(afterSequence, "afterSequence");

  const limit = normalizeLimit(input.limit);
  const canRead = input.canRead ?? (() => true);
  const ordered = projectCommittedEvents(input.events);

  const visible: TEvent[] = [];
  let nextSequence = afterSequence;
  let examined = 0;

  for (const event of ordered) {
    if (event.sequence <= afterSequence) {
      continue;
    }
    if (examined >= limit) {
      break;
    }

    examined += 1;
    nextSequence = event.sequence;

    if (canRead(event)) {
      visible.push(event);
    }
  }

  return {
    events: visible,
    nextSequence,
    hasMore: ordered.some((event) => event.sequence > nextSequence),
  };
}
