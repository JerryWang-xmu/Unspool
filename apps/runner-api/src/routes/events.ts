import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SqliteDatabase } from "../../../../packages/persistence/src/database.js";
import { ProblemError } from "../errors/problem.js";
import type { CommittedEvent } from "../events/service.js";
import { formatSseEvent, heartbeatFrame, resolveReconnectSequence } from "../events/sse.js";
import { loadWorkspaceAccess } from "../workspaces/service.js";

export interface EventRouteOptions {
  readonly database: SqliteDatabase;
  readonly resolveActorId: (request: FastifyRequest) => string | null | Promise<string | null>;
  readonly pollIntervalMs?: number;
}

interface EventRow extends CommittedEvent {
  readonly id: string;
  readonly actor_id: string | null;
  readonly run_id: string | null;
  readonly occurred_at: string;
  readonly visibility: string;
  readonly payload_ref: string;
  readonly payload_digest: string;
  readonly payload: string;
}

function visibleTo(actorId: string, ownerId: string, visibility: string): boolean {
  try {
    const value = JSON.parse(visibility) as {
      kind?: string;
      actorIds?: string[];
      memberId?: string;
    };
    if (value.kind === "owner_private") return actorId === ownerId;
    if (value.kind === "private") return value.actorIds?.includes(actorId) === true;
    if (value.kind === "member") return value.memberId === actorId;
    return true;
  } catch {
    return false;
  }
}

export function registerEventRoutes(app: FastifyInstance, options: EventRouteOptions): void {
  app.get<{
    Params: { workspaceId: string };
    Querystring: { after?: string; limit?: string };
  }>("/v1/workspaces/:workspaceId/events", async (request, reply) => {
    const actorId = await options.resolveActorId(request);
    if (actorId === null) throw new ProblemError("unauthenticated");
    const access = await loadWorkspaceAccess(options.database, actorId, request.params.workspaceId);
    const lastEventId = request.headers["last-event-id"];
    const after = resolveReconnectSequence({
      workspaceId: request.params.workspaceId,
      ...(typeof lastEventId === "string" ? { lastEventId } : {}),
      after: request.query.after === undefined ? 0 : Number(request.query.after),
    });
    const limit =
      request.query.limit === undefined
        ? 200
        : Math.min(Math.max(Number(request.query.limit) || 200, 1), 1000);
    let cursor = after;
    const pollInterval = options.pollIntervalMs ?? 500;
    reply.hijack();
    const origin = request.headers.origin;
    const allowedOrigin =
      origin !== undefined &&
      /^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|tauri:\/\/localhost|http:\/\/tauri\.localhost)$/.test(
        origin,
      )
        ? origin
        : undefined;
    reply.raw.writeHead(200, {
      ...(allowedOrigin === undefined
        ? {}
        : { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" }),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    let closed = false;
    let polling = false;
    const sendNewEvents = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const rows = await options.database.query<EventRow>(
          `SELECT id, workspace_id AS workspaceId, sequence, type, actor_id, run_id, occurred_at,
                  visibility, payload_ref, payload_digest, payload
           FROM domain_event WHERE workspace_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
          [request.params.workspaceId, cursor, limit],
        );
        for (const row of rows) {
          cursor = row.sequence;
          if (!visibleTo(actorId, access.workspace.ownerId, row.visibility)) continue;
          const event = {
            id: row.id,
            eventId: row.id,
            workspaceId: row.workspaceId,
            sequence: row.sequence,
            type: row.type,
            actorId: row.actor_id,
            runId: row.run_id,
            occurredAt: row.occurred_at,
            visibility: JSON.parse(row.visibility),
            payloadRef: row.payload_ref,
            payloadDigest: row.payload_digest,
            payload: JSON.parse(row.payload),
          };
          reply.raw.write(formatSseEvent(event));
        }
      } catch {
        if (!closed) reply.raw.write(": replay-unavailable\n\n");
      } finally {
        polling = false;
      }
    };
    await sendNewEvents();
    const interval = setInterval(() => {
      void sendNewEvents();
    }, pollInterval);
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(heartbeatFrame());
    }, 15_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
    };
    request.raw.once("close", cleanup);
    request.raw.once("aborted", cleanup);
    reply.raw.once("close", cleanup);
  });
}
