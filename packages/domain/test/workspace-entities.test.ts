import assert from "node:assert/strict";
import { test } from "vitest";
import { parseDomainEvent } from "../src/domain-event.js";
import { parseOutboxMessage } from "../src/outbox-message.js";
import { parseTransientOutput } from "../src/transient-output.js";
import { parseWorkspaceControl } from "../src/workspace-control.js";
import { parseWorkspaceMember } from "../src/workspace-member.js";

const workspaceId = "workspace-1";
const userId = "user-1";
const now = "2026-11-22T10:00:00.000Z";

test("workspace member preserves role, permissions, and timestamps", () => {
  const member = parseWorkspaceMember({
    workspaceId,
    userId,
    role: "contributor",
    canApprove: true,
    canReview: false,
    joinedAt: now,
  });
  assert.deepEqual(member, {
    workspaceId,
    userId,
    role: "contributor",
    canApprove: true,
    canReview: false,
    joinedAt: now,
    leftAt: undefined,
  });
  assert.throws(
    () =>
      parseWorkspaceMember({
        workspaceId,
        userId,
        role: "owner",
        canApprove: true,
        canReview: false,
        joinedAt: "invalid",
      }),
    /joinedAt/,
  );
  assert.throws(
    () =>
      parseWorkspaceMember({
        workspaceId,
        userId,
        role: "administrator",
        canApprove: false,
        canReview: false,
        joinedAt: now,
      }),
    /role/,
  );
});

test("workspace control enforces epochs and active run independence", () => {
  const control = parseWorkspaceControl({
    workspaceId,
    operatorId: userId,
    operatorEpoch: 2,
    activeRunEpoch: 7,
    revision: 9,
    updatedAt: now,
  });
  assert.equal(control.activeRunId, undefined);
  assert.equal(control.activeRunEpoch, 7);
  assert.throws(() => parseWorkspaceControl({ ...control, operatorEpoch: 0 }), /operatorEpoch/);
});

test("domain event is a validated append-only envelope", () => {
  const event = parseDomainEvent({
    id: "event-1",
    workspaceId,
    sequence: 1,
    schemaVersion: 1,
    type: "run.started",
    occurredAt: now,
    visibility: { kind: "workspace_members" },
    payloadRef: "payload-1",
    payloadDigest: "sha256:abc",
  });
  assert.equal(event.visibility.kind, "workspace_members");
  assert.throws(() => parseDomainEvent({ ...event, sequence: 0 }), /sequence/);
  assert.throws(() => parseDomainEvent({ ...event, visibility: null }), /visibility/);
});

test("transient output and outbox preserve sequence and state constraints", () => {
  const output = parseTransientOutput({
    runId: "run-1",
    offset: 0,
    delta: "hello",
    createdAt: now,
  });
  assert.equal(output.offset, 0);
  assert.throws(() => parseTransientOutput({ ...output, offset: -1 }), /offset/);

  const outbox = parseOutboxMessage({
    id: "outbox-1",
    domainEventId: "event-1",
    destination: "sse",
    state: "pending",
    attemptCount: 0,
    availableAt: now,
  });
  assert.equal(outbox.state, "pending");
  assert.throws(() => parseOutboxMessage({ ...outbox, state: "approved" }), /state/);
});
