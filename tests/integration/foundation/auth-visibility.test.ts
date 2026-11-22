import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const NOW = "2026-11-22T10:00:00.000Z";
const PAST = "2026-11-21T10:00:00.000Z";
const OWNER_ID = "018f2d8f-1001-7f20-80b1-aaaaaaaaaaa1";
const CONTRIBUTOR_ID = "018f2d8f-1002-7f20-80b1-aaaaaaaaaaa2";
const OUTSIDER_ID = "018f2d8f-1003-7f20-80b1-aaaaaaaaaaa3";
const WORKSPACE_ID = "018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4";

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(
    existsSync(absolute),
    `Phase 2 implementation is missing: ${relativePath}. T014 expects this module to satisfy the foundation contract.`,
  );
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

async function authorizationModule() {
  const module = await loadModule("packages/domain/src/authorization.ts");
  assert.equal(
    typeof module.createVisibilityPolicy,
    "function",
    "authorization.ts must export createVisibilityPolicy(context)",
  );
  return module;
}

function sharedContext(membership: Record<string, unknown> | null) {
  return {
    now: NOW,
    workspace: {
      id: WORKSPACE_ID,
      kind: "shared",
      ownerId: OWNER_ID,
      status: "active",
    },
    membership,
  };
}

test("workspace visibility filters events by member, role, and private recipients", async () => {
  const { createVisibilityPolicy } = await authorizationModule();
  const policy = createVisibilityPolicy(
    sharedContext({
      userId: CONTRIBUTOR_ID,
      role: "contributor",
      canApprove: false,
      canReview: false,
      joinedAt: PAST,
      leftAt: null,
    }),
  );

  const workspaceEvent = {
    id: "event-1",
    visibility: { kind: "workspace_members" },
  };
  const ownerOnlyEvent = {
    id: "event-2",
    visibility: { kind: "workspace_members", roles: ["owner"] },
  };
  const privateEvent = {
    id: "event-3",
    visibility: { kind: "private", actorIds: [OWNER_ID] },
  };
  const contributorOwnEvent = {
    id: "event-4",
    actorId: CONTRIBUTOR_ID,
    visibility: { kind: "workspace_members" },
  };
  const contributorOtherEvent = {
    id: "event-5",
    actorId: OWNER_ID,
    visibility: { kind: "workspace_members" },
  };

  assert.equal(policy.canRead(workspaceEvent), true);
  assert.equal(policy.canRead(ownerOnlyEvent), false);
  assert.equal(policy.canRead(privateEvent), false);

  const visible = policy.filter([
    workspaceEvent,
    ownerOnlyEvent,
    privateEvent,
    contributorOwnEvent,
    contributorOtherEvent,
  ]);
  assert.deepEqual(
    visible.map((event: { id: string }) => event.id),
    ["event-1", "event-4", "event-5"],
  );
  assert.equal(
    policy.authorize("write", contributorOwnEvent).allowed,
    true,
    "a contributor may edit their own content",
  );
  assert.equal(
    policy.authorize("write", contributorOtherEvent).allowed,
    false,
    "a contributor may not edit another member's content",
  );
  assert.equal(policy.authorize("approve", workspaceEvent).allowed, false);
  assert.equal(policy.authorize("review", workspaceEvent).allowed, false);
});

test("observer role is read-only even when approval flags are set", async () => {
  const { createVisibilityPolicy } = await authorizationModule();
  const policy = createVisibilityPolicy(
    sharedContext({
      userId: CONTRIBUTOR_ID,
      role: "observer",
      canApprove: true,
      canReview: true,
      joinedAt: PAST,
      leftAt: null,
    }),
  );
  const record = { id: "event-1", visibility: { kind: "workspace_members" } };

  assert.equal(policy.canRead(record), true);
  assert.equal(policy.authorize("write", record).allowed, false);
  assert.equal(policy.authorize("approve", record).allowed, false);
  assert.equal(policy.authorize("review", record).allowed, false);
});

test("left, expired, and non-member identities lose immediate access", async () => {
  const { createVisibilityPolicy } = await authorizationModule();
  const record = { id: "event-1", visibility: { kind: "workspace_members" } };

  const removed = createVisibilityPolicy(
    sharedContext({
      userId: CONTRIBUTOR_ID,
      role: "contributor",
      canApprove: true,
      canReview: true,
      joinedAt: PAST,
      leftAt: PAST,
    }),
  );
  assert.equal(removed.canRead(record), false);
  assert.equal(removed.authorize("download", record).allowed, false);

  const outsider = createVisibilityPolicy(sharedContext(null));
  assert.equal(outsider.canRead(record), false);
  assert.equal(outsider.filter([record]).length, 0);

  const archived = createVisibilityPolicy({
    now: NOW,
    workspace: {
      id: WORKSPACE_ID,
      kind: "shared",
      ownerId: OWNER_ID,
      status: "archived",
    },
    membership: {
      userId: CONTRIBUTOR_ID,
      role: "contributor",
      canApprove: false,
      canReview: false,
      joinedAt: PAST,
      leftAt: null,
    },
  });
  assert.equal(archived.canRead(record), true);
  assert.equal(archived.authorize("write", record).allowed, false);
  assert.equal(archived.authorize("export", record).allowed, true);
});

test("personal workspace owner keeps access without a workspace membership row", async () => {
  const { createVisibilityPolicy } = await authorizationModule();
  const policy = createVisibilityPolicy({
    now: NOW,
    workspace: {
      id: WORKSPACE_ID,
      kind: "personal",
      ownerId: OWNER_ID,
      status: "active",
    },
    membership: null,
  });
  const record = { id: "artifact-1", visibility: { kind: "workspace_members" } };

  assert.equal(policy.canRead(record), true);
  assert.equal(policy.authorize("download", record).allowed, true);
  assert.equal(policy.authorize("export", record).allowed, true);
});

test("unauthorized objects use a non-disclosing not-found problem", async () => {
  const { createVisibilityPolicy } = await authorizationModule();
  const policy = createVisibilityPolicy(sharedContext(null));
  const problem = policy.notFoundError();

  assert.equal(problem.status, 404);
  assert.equal(problem.code, "not_found");
  assert.equal(problem.title, "Not Found");
  assert.equal(problem.detail, "The requested resource was not found.");
  assert.equal(JSON.stringify(problem).includes(WORKSPACE_ID), false);
  assert.equal(JSON.stringify(problem).includes(OWNER_ID), false);
});

test("downloaded and exported records use the same object-level visibility filter", async () => {
  const { createVisibilityPolicy } = await authorizationModule();
  const policy = createVisibilityPolicy(sharedContext(null));
  const records = [
    {
      id: "artifact-public",
      visibility: { kind: "workspace_members" },
    },
    {
      id: "artifact-private",
      visibility: { kind: "private", actorIds: [OUTSIDER_ID] },
    },
  ];

  assert.deepEqual(policy.filter(records), []);
  assert.equal(policy.authorize("download", records[0]).allowed, false);
  assert.equal(policy.authorize("export", records[0]).allowed, false);
});
