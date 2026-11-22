import { beforeAll, describe, expect, it } from "vitest";
import {
  callApi,
  collection,
  command,
  createContextItem,
  createPersonalTask,
  entity,
  idOf,
  provisionSharedWorkspace,
  type SharedWorkspaceFixture,
  startRun,
} from "../../support/us2/harness";

/** T087 / US2 / FR-011: opt-in sharing never widens private history. */
describe("US2 selective share conversion", () => {
  let team: SharedWorkspaceFixture;
  beforeAll(async () => {
    team = await provisionSharedWorkspace({
      name: "US2 share integration",
      goal: "Copy only selected records",
      completionCriteria: "Private originals stay private",
    });
  }, 60_000);

  it("copies only selected versions and keeps private originals and personal history invisible", async () => {
    const personal = await createPersonalTask(team.runnerId, team.agentProfileId, {
      name: `US2 private ${Date.now()}`,
      goal: "Select one fact",
      completionCriteria: "No unselected record is shared",
    });
    const selected = await createContextItem("owner", personal.workspaceId, {
      kind: "fact",
      title: "Selected",
      body: "SELECTED_PUBLIC_FACT",
      memberVisibility: "members",
      agentExposure: "not_provided",
    });
    await createContextItem("owner", personal.workspaceId, {
      kind: "fact",
      title: "Private",
      body: "PRIVATE_CANARY_UNSELECTED",
      memberVisibility: "private",
      agentExposure: "not_provided",
    });
    const preview = await callApi(
      "owner",
      "POST",
      `/personal-tasks/${personal.workspaceId}/share-preview`,
      { body: command({ selectedRecordIds: [selected.versionId] }) },
    );
    expect(preview.status).toBe(200);
    const converted = await callApi(
      "owner",
      "POST",
      `/personal-tasks/${personal.workspaceId}/share`,
      {
        body: command({
          sharePreviewId: idOf(entity(preview.body, "sharePreview")),
          teamId: team.teamId,
          members: [
            { userId: team.operator.id, role: "operator", canApprove: true, canReview: true },
            { userId: team.observer.id, role: "observer" },
          ],
        }),
      },
    );
    expect(converted.status).toBe(201);
    const sharedId = idOf(entity(converted.body, "workspace"));
    const contexts = await callApi("observer", "GET", `/workspaces/${sharedId}/context-items`);
    expect(contexts.status).toBe(200);
    expect(contexts.text).toContain("SELECTED_PUBLIC_FACT");
    expect(contexts.text).not.toContain("PRIVATE_CANARY_UNSELECTED");
    expect(collection(contexts.body, "contextItems")).toHaveLength(1);
    const privateOriginal = await callApi(
      "observer",
      "GET",
      `/personal-tasks/${personal.workspaceId}`,
    );
    expect([403, 404]).toContain(privateOriginal.status);
  });

  it("refuses conversion while the source Run is active instead of sharing a moving session", async () => {
    const personal = await createPersonalTask(team.runnerId, team.agentProfileId, {
      name: `US2 active share ${Date.now()}`,
      goal: "Stop first",
      completionCriteria: "No active source run",
    });
    const selected = await createContextItem("owner", personal.workspaceId, {
      kind: "fact",
      title: "Selected",
      body: "Selected",
      memberVisibility: "members",
      agentExposure: "not_provided",
    });
    const preview = await callApi(
      "owner",
      "POST",
      `/personal-tasks/${personal.workspaceId}/share-preview`,
      { body: command({ selectedRecordIds: [selected.versionId] }) },
    );
    expect(
      (await startRun("owner", personal.workspaceId, 1, "Hold the personal run active")).status,
    ).toBe(202);
    const converted = await callApi(
      "owner",
      "POST",
      `/personal-tasks/${personal.workspaceId}/share`,
      {
        body: command({
          sharePreviewId: idOf(entity(preview.body, "sharePreview")),
          teamId: team.teamId,
          members: [{ userId: team.operator.id, role: "operator" }],
        }),
      },
    );
    expect(converted.status).toBe(409);
    expect(entity(converted.body, "problem").code).toBe("task_active");
  });
});
