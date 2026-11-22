export interface PiProjectedEvent {
  readonly kind: string;
  readonly [key: string]: unknown;
}

/**
 * pi's `tool_execution_start` is a model/tool preflight notification, not proof
 * that the controlled wrapper entered the real side-effect boundary. Only the
 * wrapper's digest-bound `tool_execution_entered` record may project that fact.
 */
export function projectToolEvents(events: readonly unknown[]): PiProjectedEvent[] {
  return events.map((value) => {
    if (typeof value !== "object" || value === null) return { kind: "unknown", value };
    const event = value as Record<string, unknown>;
    switch (event.type) {
      case "tool_execution_start":
        return { ...event, kind: "tool_preflight", executionEntered: false };
      case "tool_execution_entered":
        if (
          typeof event.effectiveArgsDigest !== "string" ||
          !/^sha256:[0-9a-f]{64}$/.test(event.effectiveArgsDigest)
        ) {
          return {
            ...event,
            kind: "tool_preflight",
            executionEntered: false,
            projectionWarning: "missing_effective_args_digest",
          };
        }
        return { ...event, kind: "tool_execution_entered", executionEntered: true };
      case "tool_finalized":
      case "tool_execution_end":
        return { ...event, kind: "tool_finalized" };
      case "message_end":
        return { ...event, kind: "message_completed", transcriptPersisted: false };
      case "session_checkpoint":
        return { ...event, kind: "checkpoint_aligned", transcriptPersisted: true };
      default:
        return {
          ...event,
          kind: typeof event.kind === "string" ? event.kind : String(event.type ?? "unknown"),
        };
    }
  });
}
