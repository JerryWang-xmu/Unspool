import { beforeAll, describe, expect, it } from "vitest";
import {
  appendContextVersion,
  callApi,
  collection,
  command,
  createContextItem,
  currentVersionId,
  entity,
  idOf,
  provisionSharedWorkspace,
  type SharedWorkspaceFixture,
  startRun,
} from "../../support/us2/harness";

/** T088 / US2 / FR-019/020/023: immutable context, explicit exposure and frozen Run snapshots. */
describe("US2 context versions and Agent exposure", () => {
  let fixture: SharedWorkspaceFixture;
  beforeAll(async () => {
    fixture = await provisionSharedWorkspace({
      name: "US2 context integration",
      goal: "Freeze context",
      completionCriteria: "Version and exposure rules hold",
    });
  }, 60_000);

  it("rejects stale edits without replacing the current immutable version", async () => {
    const created = await createContextItem("owner", fixture.workspaceId, {
      kind: "decision",
      title: "Decision",
      body: "v1",
      memberVisibility: "members",
      agentExposure: "not_provided",
    });
    const appended = await appendContextVersion(
      "owner",
      fixture.workspaceId,
      idOf(created.item),
      created.revision,
      {
        kind: "decision",
        title: "Decision",
        body: "v2",
        memberVisibility: "members",
        agentExposure: "not_provided",
      },
    );
    expect(appended.status).toBe(201);
    const stale = await appendContextVersion(
      "owner",
      fixture.workspaceId,
      idOf(created.item),
      created.revision,
      {
        kind: "decision",
        title: "Decision",
        body: "stale",
        memberVisibility: "members",
        agentExposure: "not_provided",
      },
    );
    expect(stale.status).toBe(409);
    expect(entity(stale.body, "problem").code).toBe("revision_conflict");
    const listed = await callApi(
      "owner",
      "GET",
      `/workspaces/${fixture.workspaceId}/context-items`,
    );
    const item = collection(listed.body, "contextItems").find(
      (value) => entity(value, "contextItem").id === idOf(created.item),
    );
    expect(item).toBeDefined();
    expect(currentVersionId(item)).toBe(entity(appended.body, "contextVersion").id);
    expect(JSON.stringify(item)).not.toContain("stale");
  });

  it("allows only the operator/owner to provide a version to the next Agent Run", async () => {
    const created = await createContextItem("contributor", fixture.workspaceId, {
      kind: "fact",
      title: "Exposure",
      body: "operator review required",
      memberVisibility: "members",
      agentExposure: "not_provided",
    });
    const forbidden = await appendContextVersion(
      "contributor",
      fixture.workspaceId,
      idOf(created.item),
      created.revision,
      {
        kind: "fact",
        title: "Exposure",
        body: "operator review required",
        memberVisibility: "members",
        agentExposure: "provide_next_run",
      },
    );
    expect(forbidden.status).toBe(403);
    expect(entity(forbidden.body, "problem").code).toBe("permission_denied");
    const allowed = await appendContextVersion(
      "operator",
      fixture.workspaceId,
      idOf(created.item),
      created.revision,
      {
        kind: "fact",
        title: "Exposure",
        body: "operator review required",
        memberVisibility: "members",
        agentExposure: "provide_next_run",
      },
    );
    expect(allowed.status).toBe(201);
    expect(entity(allowed.body, "contextVersion").agentExposure).toBe("provide_next_run");
  });

  it("keeps the Run context snapshot unchanged after a newer context version appears", async () => {
    const created = await createContextItem("owner", fixture.workspaceId, {
      kind: "fact",
      title: "Snapshot",
      body: "SNAPSHOT_V1",
      memberVisibility: "members",
      agentExposure: "provide_next_run",
    });
    const accepted = await startRun("operator", fixture.workspaceId, 1, "Capture context snapshot");
    expect(accepted.status).toBe(202);
    const run = entity(accepted.body, "run");
    const snapshotId = run.contextSnapshotId;
    expect(typeof snapshotId).toBe("string");
    const appended = await appendContextVersion(
      "owner",
      fixture.workspaceId,
      idOf(created.item),
      created.revision,
      {
        kind: "fact",
        title: "Snapshot",
        body: "SNAPSHOT_V2_AFTER_RUN",
        memberVisibility: "members",
        agentExposure: "not_provided",
      },
    );
    expect(appended.status).toBe(201);
    const detail = await callApi(
      "operator",
      "GET",
      `/workspaces/${fixture.workspaceId}/runs/${idOf(run)}`,
    );
    expect(detail.status).toBe(200);
    expect(entity(detail.body, "run").contextSnapshotId).toBe(snapshotId);
    expect(detail.text).not.toContain("SNAPSHOT_V2_AFTER_RUN");
  });
});
