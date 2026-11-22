import { useId } from "react";
import type { TimelineEvent } from "../../api/types";

export interface TimelineFilterState {
  readonly types: readonly string[];
  readonly unreadOnly: boolean;
}

export const EMPTY_TIMELINE_FILTERS: TimelineFilterState = {
  types: [],
  unreadOnly: false,
};

export interface TimelineFiltersProps {
  readonly filters: TimelineFilterState;
  readonly availableTypes: readonly string[];
  readonly unreadEventIds?: readonly string[] | ReadonlySet<string> | undefined;
  readonly unreadCount?: number | undefined;
  readonly typeCounts?: Readonly<Record<string, number>> | undefined;
  readonly totalCount?: number | undefined;
  readonly matchingCount?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly onFiltersChange: (filters: TimelineFilterState) => void;
  readonly onMarkRead?: (() => void) | undefined;
}

export function filterTimelineEvents(
  events: readonly TimelineEvent[],
  filters: TimelineFilterState,
  unreadEventIds?: readonly string[] | ReadonlySet<string> | undefined,
): readonly TimelineEvent[] {
  const selectedTypes = new Set(filters.types);
  const unread = unreadEventIds instanceof Set ? unreadEventIds : new Set(unreadEventIds ?? []);
  return events.filter((event) => {
    if (selectedTypes.size > 0 && !selectedTypes.has(event.type)) {
      return false;
    }
    if (filters.unreadOnly && !unread.has(event.id)) {
      return false;
    }
    return true;
  });
}

export function TimelineFilters({
  filters,
  availableTypes,
  unreadEventIds,
  unreadCount,
  typeCounts,
  totalCount,
  matchingCount,
  disabled = false,
  onFiltersChange,
  onMarkRead,
}: TimelineFiltersProps) {
  const typesId = useId();
  const unreadId = useId();
  const types = [...new Set(availableTypes)].sort((left, right) => left.localeCompare(right));
  const unread =
    unreadCount ??
    (unreadEventIds === undefined
      ? 0
      : Array.isArray(unreadEventIds)
        ? unreadEventIds.length
        : (unreadEventIds as ReadonlySet<string>).size);
  const selectedTypes = new Set(filters.types);

  function toggleType(type: string, checked: boolean): void {
    const next = checked
      ? [...new Set([...filters.types, type])]
      : filters.types.filter((candidate) => candidate !== type);
    onFiltersChange({ ...filters, types: next });
  }

  return (
    <section className="panel" data-testid="timeline-filters" aria-labelledby={typesId}>
      <div className="timeline__filter">
        <h3 id={typesId}>Timeline filters</h3>
        <p className="field__hint">
          Filters only change this view. They never hide risky events from the shared record.
        </p>
        <p className="field__hint" role="status" aria-live="polite">
          {matchingCount !== undefined && totalCount !== undefined
            ? `Showing ${String(matchingCount)} of ${String(totalCount)} events.`
            : "Showing the events that match the current filters."}{" "}
          {unread === 0
            ? "No unread changes."
            : `${String(unread)} unread change${unread === 1 ? "" : "s"}.`}
        </p>
      </div>

      <fieldset className="field" disabled={disabled}>
        <legend>Event types</legend>
        <div className="button-row">
          <button
            type="button"
            className="button button--ghost"
            aria-pressed={filters.types.length === 0}
            onClick={() => onFiltersChange({ ...filters, types: [] })}
            disabled={disabled || filters.types.length === 0}
          >
            All types
          </button>
          {types.map((type) => {
            const count = typeCounts?.[type];
            return (
              <label key={type} className="tag">
                <input
                  type="checkbox"
                  data-testid="timeline-filter-type"
                  checked={selectedTypes.has(type)}
                  onChange={(event) => toggleType(type, event.currentTarget.checked)}
                  disabled={disabled}
                />{" "}
                {type}
                {count === undefined ? "" : ` (${String(count)})`}
              </label>
            );
          })}
        </div>
        {types.length === 0 ? (
          <p className="field__hint">No event types are available yet.</p>
        ) : null}
      </fieldset>

      <div className="field">
        <label htmlFor={unreadId}>
          <input
            id={unreadId}
            type="checkbox"
            data-testid="timeline-filter-unread"
            checked={filters.unreadOnly}
            onChange={(event) =>
              onFiltersChange({ ...filters, unreadOnly: event.currentTarget.checked })
            }
            disabled={disabled}
          />{" "}
          Only show unread changes
        </label>
        {onMarkRead !== undefined ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={onMarkRead}
            disabled={disabled || unread === 0}
          >
            Mark all read
          </button>
        ) : null}
      </div>
    </section>
  );
}
