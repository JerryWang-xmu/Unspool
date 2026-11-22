import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const NOW = "2026-11-22T10:00:00.000Z";
const ACTOR_ID = "018f2d8f-1001-7f20-80b1-aaaaaaaaaaa1";
const WORKSPACE_ID = "018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(
    existsSync(absolute),
    `Phase 2 implementation is missing: ${relativePath}. T014 expects this module to satisfy the foundation contract.`,
  );
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

const event = (
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  visibility: Record<string, unknown> = { kind: "workspace_members" },
) => ({
  schemaVersion: 1,
  eventId: `018f2d8f-3000-7f20-80b1-${String(sequence).padStart(12, "0")}`,
  workspaceId: WORKSPACE_ID,
  sequence,
  type,
  occurredAt: NOW,
  actor: { actorId: ACTOR_ID, displayNameAtTime: "Operator", rolesAtTime: ["operator"] },
  visibility,
  payloadDigest: digest(JSON.stringify(payload)),
  payload,
});

test("command envelopes reject missing IDs and malformed payload digests", async () => {
  const commandModule = await loadModule("packages/domain/src/command.ts");
  assert.equal(
    typeof commandModule.assertCommandEnvelope,
    "function",
    "command.ts must export assertCommandEnvelope(envelope)",
  );

  const valid = {
    schemaVersion: 1,
    commandId: "018f2d8f-2001-7f20-80b1-bbbbbbbbbbb1",
    actorId: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    payloadDigest: digest("command"),
    kind: "start",
  };
  assert.doesNotThrow(() => commandModule.assertCommandEnvelope(valid));
  assert.throws(
    () => commandModule.assertCommandEnvelope({ ...valid, commandId: undefined }),
    /commandId/i,
  );
  assert.throws(
    () => commandModule.assertCommandEnvelope({ ...valid, payloadDigest: "md5:abc" }),
    /payloadDigest/i,
  );
  assert.throws(
    () => commandModule.assertCommandEnvelope({ ...valid, actorId: undefined }),
    /actorId/i,
  );
});

test("command receipt replay returns the first response and conflicts on a different payload", async () => {
  const commandModule = await loadModule("packages/domain/src/command.ts");
  assert.equal(
    typeof commandModule.evaluateCommandReplay,
    "function",
    "command.ts must export evaluateCommandReplay(existingReceipt, incomingEnvelope)",
  );

  const envelope = {
    schemaVersion: 1,
    commandId: "018f2d8f-2001-7f20-80b1-bbbbbbbbbbb1",
    actorId: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    payloadDigest: digest("same-payload"),
    kind: "start",
  };
  assert.equal(commandModule.evaluateCommandReplay(undefined, envelope), "accept");
  assert.equal(
    commandModule.evaluateCommandReplay(
      {
        commandId: envelope.commandId,
        payloadDigest: envelope.payloadDigest,
        response: { runId: "018f2d8f-3001-7f20-80b1-ccccccccccc1" },
      },
      envelope,
    ),
    "replay",
  );
  assert.equal(
    commandModule.evaluateCommandReplay(
      {
        commandId: envelope.commandId,
        payloadDigest: envelope.payloadDigest,
        response: { runId: "018f2d8f-3001-7f20-80b1-ccccccccccc1" },
      },
      { ...envelope, payloadDigest: digest("different-payload") },
    ),
    "conflict",
  );
});

test("event replay uses keyset cursors and boundaries hidden records without leaking them", async () => {
  const eventsModule = await loadModule("apps/runner-api/src/events/service.ts");
  assert.equal(
    typeof eventsModule.replayEvents,
    "function",
    "events/service.ts must export replayEvents(input)",
  );

  const committed = [
    event(1, "run.started", { state: "running" }),
    event(
      2,
      "private.qa",
      { question: "secret", answer: "secret" },
      {
        kind: "private",
        actorIds: ["018f2d8f-1002-7f20-80b1-aaaaaaaaaaa2"],
      },
    ),
    event(3, "run.settled", { state: "settled" }),
  ];
  const canRead = (candidate: { type: string }) => candidate.type !== "private.qa";

  const firstPage = eventsModule.replayEvents({
    events: committed,
    afterSequence: 0,
    limit: 2,
    canRead,
  });
  assert.deepEqual(
    firstPage.events.map((candidate: { sequence: number }) => candidate.sequence),
    [1],
  );
  assert.equal(firstPage.nextSequence, 2);
  assert.equal(firstPage.hasMore, true);

  const secondPage = eventsModule.replayEvents({
    events: committed,
    afterSequence: firstPage.nextSequence,
    limit: 2,
    canRead,
  });
  assert.deepEqual(
    secondPage.events.map((candidate: { sequence: number }) => candidate.sequence),
    [3],
  );
  assert.equal(secondPage.nextSequence, 3);
  assert.equal(secondPage.hasMore, false);
  assert.equal(JSON.stringify(firstPage).includes("secret"), false);
  assert.equal(JSON.stringify(secondPage).includes("secret"), false);

  const afterEnd = eventsModule.replayEvents({
    events: committed,
    afterSequence: 3,
    limit: 2,
    canRead,
  });
  assert.deepEqual(afterEnd.events, []);
  assert.equal(afterEnd.nextSequence, 3);
  assert.equal(afterEnd.hasMore, false);
  assert.equal(committed.length, 3);
});

test("SSE frames carry the workspace sequence, event type, and complete filtered envelope", async () => {
  const sseModule = await loadModule("apps/runner-api/src/events/sse.ts");
  assert.equal(typeof sseModule.formatSseEvent, "function");
  assert.equal(typeof sseModule.heartbeatFrame, "function");
  assert.equal(typeof sseModule.parseLastEventId, "function");

  const filtered = event(7, "run.approval_decided", { decision: "approved" });
  const frame = sseModule.formatSseEvent(filtered);
  assert.match(frame, /^id: 018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4:7\n/);
  assert.match(frame, /\nevent: run\.approval_decided\n/);
  assert.match(frame, /\ndata: /);
  assert.ok(frame.endsWith("\n\n"));

  const dataLine = String(frame)
    .split("\n")
    .find((line: string) => line.startsWith("data: "));
  assert.ok(dataLine);
  assert.deepEqual(JSON.parse(dataLine.slice("data: ".length)), filtered);

  assert.equal(sseModule.heartbeatFrame(), ": heartbeat\n\n");
  assert.deepEqual(sseModule.parseLastEventId(`${WORKSPACE_ID}:7`), {
    workspaceId: WORKSPACE_ID,
    sequence: 7,
  });
  assert.throws(() => sseModule.parseLastEventId("not-an-event-id"), /Last-Event-ID/i);
});
