import { beforeAll, describe, expect, it } from "vitest";
import {
  activeRunId,
  asRecord,
  calculateStableNorthStar,
  callApi,
  collection,
  command,
  entity,
  hasToken,
  idOf,
  ifMatch,
  listRuns,
  provisionSharedWorkspace,
  type SharedWorkspaceFixture,
  startRun,
} from "../../support/us2/harness";

/** T089 / US2 / FR-029/037/040/052/074: role fencing and effective collaboration. */
describe("US2 concurrency and role boundaries", () => {
  let fixture: SharedWorkspaceFixture;
  beforeAll(async () => {
    fixture = await provisionSharedWorkspace({
      name: "US2 concurrency integration",
      goal: "Fence roles",
      completionCriteria: "One active run and immediate revocation",
    });
  }, 60_000);

  it("admits exactly one active Run across five concurrent start commands", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        startRun("operator", fixture.workspaceId, 1, `Concurrent start ${index}`),
      ),
    );
    expect(responses.filter((response) => response.status === 202)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
    const runs = await listRuns("operator", fixture.workspaceId);
    expect(runs.filter((run) => activeRunId([run]) !== undefined)).toHaveLength(1);
  });

  it("separates observer, contributor and operator capabilities without creating unauthorized Runs", async () => {
    expect(
      (await callApi("observer", "GET", `/workspaces/${fixture.workspaceId}/context-items`)).status,
    ).toBe(200);
    expect(
      (
        await callApi("observer", "POST", `/workspaces/${fixture.workspaceId}/discussions`, {
          body: command({ body: "Observer must not post" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callApi("contributor", "POST", `/workspaces/${fixture.workspaceId}/discussions`, {
          body: command({ body: "Contributor discussion" }),
        })
      ).status,
    ).toBe(201);
    const started = await startRun(
      "contributor",
      fixture.workspaceId,
      1,
      "Contributor must not start",
    );
    expect(started.status).toBe(403);
    expect(entity(started.body, "problem").code).toBe("permission_denied");
  });

  it("revokes disabled and expired experts from existing sessions and historical Runs immediately", async () => {
    if (
      !hasToken("expert") ||
      fixture.expert === undefined ||
      fixture.teamMemberships.expert === undefined
    )
      throw new Error(
        "[US2 setup missing] UNSPOOL_US2_EXPERT_TOKEN is required for revocation integration",
      );
    expect((await callApi("expert", "GET", `/workspaces/${fixture.workspaceId}`)).status).toBe(200);
    expect((await listRuns("expert", fixture.workspaceId)).length).toBeGreaterThanOrEqual(0);
    const membershipId = idOf(entity(fixture.teamMemberships.expert, "membership"));
    const teamResponse = await callApi("owner", "GET", "/teams");
    const teamView = collection(teamResponse.body, "teams")
      .map((entry) => asRecord(entry, "team"))
      .find((entry) => entry.id === fixture.teamId);
    const membershipRevision = Number(teamView?.revision);
    const disabled = await callApi(
      "owner",
      "PATCH",
      `/teams/${fixture.teamId}/members/${membershipId}`,
      {
        headers: { "If-Match": ifMatch(membershipRevision) },
        body: command({ status: "disabled" }),
      },
    );
    expect(disabled.status).toBe(200);
    expect((await callApi("expert", "GET", `/workspaces/${fixture.workspaceId}`)).status).toBe(403);
    expect((await callApi("expert", "GET", `/workspaces/${fixture.workspaceId}/runs`)).status).toBe(
      403,
    );
    const restored = await callApi(
      "owner",
      "PATCH",
      `/teams/${fixture.teamId}/members/${membershipId}`,
      {
        headers: { "If-Match": ifMatch(Number(entity(disabled.body, "membership").revision)) },
        body: command({ status: "active", expiresAt: new Date(Date.now() + 1_500).toISOString() }),
      },
    );
    expect(restored.status).toBe(200);
    expect((await callApi("expert", "GET", `/workspaces/${fixture.workspaceId}`)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    expect((await callApi("expert", "GET", `/workspaces/${fixture.workspaceId}`)).status).toBe(403);
    expect((await callApi("expert", "GET", `/workspaces/${fixture.workspaceId}/runs`)).status).toBe(
      403,
    );
  });
});

describe("US2 Stable north-star metric", () => {
  it("counts completed work with two effective members, never views or one-person activity", async () => {
    const base = { week: "2026-W47", memberIds: ["owner", "operator"], viewCount: 100 };
    const result = await calculateStableNorthStar({
      week: "2026-W47",
      workspaces: [
        {
          ...base,
          workspaceId: "effective",
          completedAgentRunCount: 1,
          effectiveActions: [
            { actorId: "owner", kind: "discussion" },
            { actorId: "operator", kind: "suggestion_adopted" },
          ],
        },
        {
          ...base,
          workspaceId: "views-only",
          completedAgentRunCount: 1,
          effectiveActions: [
            { actorId: "owner", kind: "view" },
            { actorId: "operator", kind: "login" },
          ],
        },
        {
          ...base,
          workspaceId: "one-person",
          completedAgentRunCount: 1,
          effectiveActions: [
            { actorId: "owner", kind: "discussion" },
            { actorId: "owner", kind: "context_edit" },
          ],
        },
        {
          ...base,
          workspaceId: "incomplete",
          completedAgentRunCount: 0,
          effectiveActions: [
            { actorId: "owner", kind: "discussion" },
            { actorId: "operator", kind: "discussion" },
          ],
        },
      ],
    });
    expect(result).toEqual({ count: 1, workspaceIds: ["effective"] });
  });
});
