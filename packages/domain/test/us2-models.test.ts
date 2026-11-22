import { describe, expect, it } from "vitest";

import {
  advanceContextItemVersion,
  createContextItem,
  removeContextItem,
} from "../src/context-item.js";
import {
  type AppendContextVersionInput,
  ContextVersionConflictError,
  canMemberReadContextVersion,
  createContextVersion,
  createNextContextVersion,
  isAgentExposed,
} from "../src/context-version.js";
import {
  createMembership,
  effectiveMembershipStatus,
  membershipAccess,
} from "../src/membership.js";
import { createTeam, disableBetaOnUpgrade } from "../src/team.js";

const NOW = "2026-11-22T00:00:00.000Z";
const EXPIRES_AT = "2026-12-01T00:00:00.000Z";

function attribution(actorId = "user-1") {
  return {
    actorId,
    displayNameAtTime: "Ada",
    rolesAtTime: ["member"],
    occurredAt: NOW,
  };
}

function versionInput(
  overrides: Partial<AppendContextVersionInput> = {},
): AppendContextVersionInput {
  return {
    id: "version-1",
    contextItemId: "item-1",
    title: "Goal",
    body: "Ship the collaboration model",
    sourceRefs: ["source-1"],
    memberVisibility: "members",
    agentExposure: "not_provided",
    attribution: attribution(),
    ...overrides,
  };
}

describe("US2 team model", () => {
  it("creates every team with Beta disabled and never enables it during upgrade", () => {
    const team = createTeam({
      id: "team-1",
      name: "Research",
      createdAt: NOW,
    });

    expect(team).toMatchObject({
      betaEnabled: false,
      defaultPolicyRevision: 1,
    });
    expect(Object.isFrozen(team)).toBe(true);

    const upgraded = disableBetaOnUpgrade({ ...team, betaEnabled: true });
    expect(upgraded.betaEnabled).toBe(false);
  });
});

describe("US2 membership model", () => {
  it("revokes identity, sessions, and history at expiry while preserving attribution", () => {
    const membership = createMembership({
      id: "membership-1",
      teamId: "team-1",
      userId: "expert-1",
      teamRoles: ["member"],
      expiresAt: EXPIRES_AT,
    });

    expect(membershipAccess(membership, "2026-11-30T23:59:59.999Z")).toMatchObject({
      effectiveStatus: "active",
      identityActive: true,
      existingSessionsActive: true,
      workspaceReadActive: true,
      workspaceOperationsActive: true,
      historicalWorkspaceReadActive: true,
      attributionPreserved: true,
    });

    expect(membershipAccess(membership, EXPIRES_AT)).toMatchObject({
      effectiveStatus: "expired",
      identityActive: false,
      existingSessionsActive: false,
      workspaceReadActive: false,
      workspaceOperationsActive: false,
      historicalWorkspaceReadActive: false,
      attributionPreserved: true,
    });
  });

  it("treats disabled memberships as immediately inactive", () => {
    const membership = createMembership({
      id: "membership-2",
      teamId: "team-1",
      userId: "user-2",
      teamRoles: ["administrator"],
      status: "disabled",
    });

    expect(effectiveMembershipStatus(membership, NOW)).toBe("disabled");
    expect(membershipAccess(membership, NOW).identityActive).toBe(false);
    expect(membershipAccess(membership, NOW).attributionPreserved).toBe(true);
  });
});

describe("US2 context model", () => {
  it("keeps context item removal as state and advances the current version pointer", () => {
    const item = createContextItem({
      id: "item-1",
      workspaceId: "workspace-1",
      kind: "goal",
      currentVersionId: "version-1",
      createdBy: "user-1",
      createdAt: NOW,
    });

    const advanced = advanceContextItemVersion(item, "version-2");
    expect(advanced.currentVersionId).toBe("version-2");

    const removed = removeContextItem(advanced, NOW);
    expect(removed.removedAt).toBe(NOW);
    expect(removed.currentVersionId).toBe("version-2");
    expect(removeContextItem(removed, "2026-11-23T00:00:00.000Z")).toBe(removed);
    expect(() => advanceContextItemVersion(removed, "version-3")).toThrow(/removed/i);
  });

  it("creates immutable versions and rejects stale expected versions", () => {
    const first = createNextContextVersion(null, 0, versionInput());

    expect(first.version).toBe(1);
    expect(first.supersedesId).toBeUndefined();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sourceRefs)).toBe(true);
    expect(Object.isFrozen(first.attribution)).toBe(true);
    expect(Object.isFrozen(first.attribution.rolesAtTime)).toBe(true);
    expect(() => {
      (first as { title: string }).title = "Changed";
    }).toThrow(TypeError);

    expect(() => createNextContextVersion(first, 0, versionInput({ id: "version-2" }))).toThrow(
      ContextVersionConflictError,
    );

    const second = createNextContextVersion(first, 1, versionInput({ id: "version-2" }));
    expect(second.version).toBe(2);
    expect(second.supersedesId).toBe(first.id);
  });

  it("keeps member visibility and Agent exposure independent", () => {
    const membersOnly = createContextVersion({
      ...versionInput(),
      version: 1,
      memberVisibility: "members",
      agentExposure: "not_provided",
    });
    const privateForAgent = createContextVersion({
      ...versionInput({ id: "version-2" }),
      version: 2,
      memberVisibility: "private",
      agentExposure: "provide_next_run",
    });

    expect(canMemberReadContextVersion(membersOnly, "user-2")).toBe(true);
    expect(isAgentExposed(membersOnly)).toBe(false);

    expect(canMemberReadContextVersion(privateForAgent, "user-2")).toBe(false);
    expect(canMemberReadContextVersion(privateForAgent, "user-1")).toBe(true);
    expect(isAgentExposed(privateForAgent)).toBe(true);
  });
});
