import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  activeRunId,
  appendContextVersion,
  asRecord,
  callApi,
  collection,
  command,
  createContextItem,
  createPersonalTask,
  currentVersionId,
  entity,
  idOf,
  ifMatch,
  listRuns,
  newIdempotencyKey,
  problemCode,
  provisionSharedWorkspace,
  revisionOf,
  type SharedWorkspaceFixture,
  startRun,
} from "../../support/us2/harness";

const contractPath = fileURLToPath(
  new URL(
    "../../../specs/001-agent-federated-collaboration/contracts/runner-api.openapi.yaml",
    import.meta.url,
  ),
);

describe("US2 Runner API contract", () => {
  describe("OpenAPI surface used by collaboration", () => {
    const spec = readFileSync(contractPath, "utf8");

    it("publishes every team, workspace, context, input and sharing operation", () => {
      for (const operationId of [
        "createTeam",
        "inviteTeamMember",
        "updateTeamMembership",
        "createSharedWorkspace",
        "getWorkspaceOverview",
        "updateWorkspace",
        "archiveWorkspace",
        "inviteWorkspaceMember",
        "listContextItems",
        "createContextItem",
        "appendContextVersion",
        "postDiscussion",
        "postSuggestion",
        "decideSuggestion",
        "startRun",
        "createSharePreview",
        "convertPersonalTaskToShared",
      ]) {
        expect(spec).toContain(`operationId: ${operationId}`);
      }
    });

    it("keeps US2 enums, version preconditions, and acceptance semantics explicit", () => {
      expect(spec).toContain(
        "role: { type: string, enum: [owner, operator, contributor, observer] }",
      );
      expect(spec).toContain("enum: [goal, fact, decision, constraint, todo, blocker, reference]");
      expect(spec).toContain("enum: [members, private]");
      expect(spec).toContain("enum: [not_provided, pending_operator, provide_next_run]");
      expect(spec).toContain("enum: [adopted, edited_adopted, ignored]");
      expect(spec).toContain("status: { type: string, enum: [draft, active, archived] }");
      expect(spec).toContain(
        "enum: [created, running, waiting_approval, stopping, technical_complete, failed, cancelled, needs_confirmation]",
      );
      expect(spec).toMatch(/appendContextVersion[\s\S]*?IfMatch/);
      expect(spec).toMatch(
        /operationId: convertPersonalTaskToShared[\s\S]*?"201": \{ \$ref: "#\/components\/responses\/Workspace" \}/,
      );
      expect(spec).toMatch(
        /operationId: startRun[\s\S]*?"202": \{ \$ref: "#\/components\/responses\/RunAccepted" \}/,
      );
    });
  });

  describe("live collaboration surface", () => {
    let fixture: SharedWorkspaceFixture;

    beforeAll(async () => {
      fixture = await provisionSharedWorkspace({
        name: "US2 contract workspace",
        goal: "Prove the shared collaboration contract",
        completionCriteria: "Selected records and three input modes are observable",
      });
    }, 60_000);

    it("returns team, membership and workspace projections with roles and no credentials", async () => {
      const members = await callApi("owner", "GET", `/teams/${fixture.teamId}/members`);
      expect(members.status).toBe(200);
      const memberList = collection(members.body, "members").map((entry) =>
        asRecord(entry, "team member"),
      );
      expect(memberList.length).toBeGreaterThanOrEqual(3);
      expect(memberList.map((member) => member.userId)).toContain(fixture.contributor.id);
      expect(memberList.map((member) => member.userId)).toContain(fixture.observer.id);

      const overview = await callApi("contributor", "GET", `/workspaces/${fixture.workspaceId}`);
      expect(overview.status).toBe(200);
      const workspace = entity(overview.body, "workspace");
      expect(workspace.kind).toBe("shared");
      expect(workspace.teamId).toBe(fixture.teamId);
      expect(workspace.runnerId).toBe(fixture.runnerId);
      expect(workspace.status === "draft" || workspace.status === "active").toBe(true);
      expect(typeof workspace.revision).toBe("number");
      expect(asRecord(workspace.currentOperator, "current operator")).toHaveProperty("operatorId");
      expect(JSON.stringify(workspace)).not.toMatch(/"credential"\s*:/i);
    });

    it("allows a draft but rejects a start until goal, criteria, operator and approver are complete", async () => {
      const draftResponse = await callApi("owner", "POST", "/workspaces", {
        body: command({
          name: `US2 draft ${Date.now()}`,
          teamId: fixture.teamId,
          runnerId: fixture.runnerId,
          agentProfileId: fixture.agentProfileId,
        }),
      });
      expect(draftResponse.status).toBe(201);
      const draft = entity(draftResponse.body, "workspace");
      const draftId = idOf(draft);
      expect(draft.status).toBe("draft");

      const rejected = await startRun("owner", draftId, 1, "must not start");
      expect(rejected.status).not.toBe(202);

      const patched = await callApi("owner", "PATCH", `/workspaces/${draftId}`, {
        headers: { "If-Match": ifMatch(revisionOf(draft, "workspace")) },
        body: command({
          goal: "Complete the draft before starting",
          completionCriteria: "An operator and approver are assigned",
        }),
      });
      expect(patched.status).toBe(200);

      const memberInvite = await callApi("owner", "POST", `/workspaces/${draftId}/members`, {
        body: command({
          members: [
            {
              userId: fixture.operator.id,
              role: "operator",
              canApprove: true,
              canReview: true,
            },
          ],
        }),
      });
      expect(memberInvite.status).toBe(201);

      const completed = await callApi("owner", "GET", `/workspaces/${draftId}`);
      const completedWorkspace = entity(completed.body, "workspace");
      const operatorEpoch = asRecord(
        completedWorkspace.currentOperator,
        "current operator",
      ).operatorEpoch;
      expect(typeof operatorEpoch).toBe("number");

      const accepted = await startRun(
        "operator",
        draftId,
        operatorEpoch as number,
        "start only after the workspace is complete",
      );
      expect(accepted.status).toBe(202);
      const run = entity(accepted.body, "run");
      expect(run.workspaceId).toBe(draftId);
      expect(typeof run.contextSnapshotId).toBe("string");
    });

    it("keeps discussion, suggestion and direct instruction as distinct commands", async () => {
      const runsBefore = await listRuns("observer", fixture.workspaceId);

      const discussion = await callApi(
        "contributor",
        "POST",
        `/workspaces/${fixture.workspaceId}/discussions`,
        { body: command({ body: "Discussion: confirm the acceptance boundary" }) },
      );
      expect(discussion.status).toBe(201);
      const discussionItem = entity(discussion.body, "input");
      expect(discussionItem.kind).toBe("discussion");

      const suggestion = await callApi(
        "contributor",
        "POST",
        `/workspaces/${fixture.workspaceId}/suggestions`,
        { body: command({ body: "Suggestion: add the missing acceptance case" }) },
      );
      expect(suggestion.status).toBe(201);
      const suggestionItem = entity(suggestion.body, "input");
      expect(suggestionItem.kind).toBe("suggestion");
      expect(suggestionItem.status === "pending" || suggestionItem.status === undefined).toBe(true);
      const suggestionId = idOf(suggestionItem);

      const runsAfterDiscussion = await listRuns("observer", fixture.workspaceId);
      expect(runsAfterDiscussion).toHaveLength(runsBefore.length);

      const contributorDecision = await callApi(
        "contributor",
        "POST",
        `/workspaces/${fixture.workspaceId}/suggestions/${suggestionId}/decision`,
        { body: command({ decision: "adopted" }) },
      );
      expect(contributorDecision.status).toBe(403);
      expect(problemCode(contributorDecision.body)).toBe("permission_denied");

      const operatorDecision = await callApi(
        "operator",
        "POST",
        `/workspaces/${fixture.workspaceId}/suggestions/${suggestionId}/decision`,
        {
          body: command({
            decision: "edited_adopted",
            editedBody: "Suggestion accepted with an operator edit",
          }),
        },
      );
      expect(operatorDecision.status).toBe(200);
      const decided = entity(operatorDecision.body, "suggestion");
      expect(["adopted", "edited_adopted"]).toContain(decided.status);
      expect(decided.editedBody).toBe("Suggestion accepted with an operator edit");
      expect(idOf(decided, "decidedBy")).toBe(fixture.operator.id);

      const contributorStart = await startRun(
        "contributor",
        fixture.workspaceId,
        1,
        "contributors cannot send direct Agent instructions",
      );
      expect(contributorStart.status).toBe(403);
      expect(problemCode(contributorStart.body)).toBe("permission_denied");
    });

    it("requires If-Match for context versions and rejects stale edits with revision_conflict", async () => {
      const created = await createContextItem("owner", fixture.workspaceId, {
        kind: "decision",
        title: "Contract decision",
        body: "Version one of the decision",
        memberVisibility: "members",
        agentExposure: "not_provided",
        sourceRefs: [],
      });

      const appended = await appendContextVersion(
        "owner",
        fixture.workspaceId,
        idOf(created.item),
        created.revision,
        {
          kind: "decision",
          title: "Contract decision",
          body: "Version two of the decision",
          memberVisibility: "members",
          agentExposure: "provide_next_run",
          sourceRefs: [],
        },
      );
      expect(appended.status).toBe(201);
      expect(entity(appended.body, "contextVersion").version).toBe(2);

      const stale = await appendContextVersion(
        "owner",
        fixture.workspaceId,
        idOf(created.item),
        created.revision,
        {
          kind: "decision",
          title: "Contract decision",
          body: "Stale write must fail",
          memberVisibility: "members",
          agentExposure: "not_provided",
        },
      );
      expect(stale.status).toBe(409);
      expect(problemCode(stale.body)).toBe("revision_conflict");

      const missingIfMatch = await callApi(
        "owner",
        "POST",
        `/workspaces/${fixture.workspaceId}/context-items/${idOf(created.item)}/versions`,
        {
          body: command({
            kind: "decision",
            title: "Contract decision",
            body: "Missing If-Match",
            memberVisibility: "members",
            agentExposure: "not_provided",
          }),
        },
      );
      expect(missingIfMatch.status).toBe(400);
      expect(problemCode(missingIfMatch.body)).toBe("invalid_request");

      const invalidEnum = await callApi(
        "owner",
        "POST",
        `/workspaces/${fixture.workspaceId}/context-items`,
        {
          body: command({
            kind: "decision",
            title: "Invalid exposure",
            body: "Must be rejected",
            memberVisibility: "members",
            agentExposure: "provided",
          }),
        },
      );
      expect(invalidEnum.status).toBe(400);
      expect(problemCode(invalidEnum.body)).toBe("invalid_request");

      const listed = await callApi(
        "owner",
        "GET",
        `/workspaces/${fixture.workspaceId}/context-items`,
      );
      expect(listed.status).toBe(200);
      const listedItems = collection(listed.body, "contextItems").map((entry) =>
        asRecord(entry, "context item"),
      );
      const stored = listedItems.find((item) => item.id === idOf(created.item));
      expect(stored).toBeDefined();
      expect(currentVersionId(stored)).not.toBe(created.versionId);
    });

    it("requires explicit selection for sharing and members for conversion", async () => {
      const personal = await createPersonalTask(fixture.runnerId, fixture.agentProfileId, {
        name: `US2 share contract ${Date.now()}`,
        goal: "Share exactly one context record",
        completionCriteria: "The shared workspace contains only the selection",
      });
      const selected = await createContextItem("owner", personal.workspaceId, {
        kind: "fact",
        title: "Selected fact",
        body: "This record is selected for sharing",
        memberVisibility: "members",
        agentExposure: "not_provided",
      });

      const missingSelection = await callApi(
        "owner",
        "POST",
        `/personal-tasks/${personal.workspaceId}/share-preview`,
        { body: command({}) },
      );
      expect(missingSelection.status).toBe(400);
      expect(problemCode(missingSelection.body)).toBe("invalid_request");

      const preview = await callApi(
        "owner",
        "POST",
        `/personal-tasks/${personal.workspaceId}/share-preview`,
        { body: command({ selectedRecordIds: [selected.versionId] }) },
      );
      expect(preview.status).toBe(200);
      const previewRecord = entity(preview.body, "sharePreview");
      expect(previewRecord.selectedRecordIds).toContain(selected.versionId);
      expect(Array.isArray(previewRecord.excludedCategories)).toBe(true);
      expect(typeof previewRecord.expiresAt).toBe("string");

      const missingMembers = await callApi(
        "owner",
        "POST",
        `/personal-tasks/${personal.workspaceId}/share`,
        {
          body: command({
            sharePreviewId: idOf(previewRecord),
            teamId: fixture.teamId,
            members: [],
          }),
        },
      );
      expect(missingMembers.status).toBe(400);
      expect(problemCode(missingMembers.body)).toBe("invalid_request");

      const converted = await callApi(
        "owner",
        "POST",
        `/personal-tasks/${personal.workspaceId}/share`,
        {
          body: command({
            sharePreviewId: idOf(previewRecord),
            teamId: fixture.teamId,
            members: [
              {
                userId: fixture.operator.id,
                role: "operator",
                canApprove: true,
                canReview: true,
              },
              {
                userId: fixture.contributor.id,
                role: "contributor",
                canApprove: false,
                canReview: true,
              },
            ],
          }),
        },
      );
      expect(converted.status).toBe(201);
      const shared = entity(converted.body, "workspace");
      expect(shared.kind).toBe("shared");
      expect(shared.teamId).toBe(fixture.teamId);
      expect(idOf(shared)).not.toBe(personal.workspaceId);
    });

    it("replays idempotent commands and returns redacted RFC 9457 problems", async () => {
      const body = command({ name: `US2 idempotent ${Date.now()}` });
      const key = newIdempotencyKey();
      const first = await callApi("owner", "POST", "/teams", {
        body,
        idempotencyKey: key,
      });
      expect(first.status).toBe(201);
      const teamId = idOf(first.body);

      const replay = await callApi("owner", "POST", "/teams", {
        body,
        idempotencyKey: key,
      });
      expect([200, 201]).toContain(replay.status);
      expect(idOf(replay.body)).toBe(teamId);

      const conflicting = await callApi("owner", "POST", "/teams", {
        body: command({ name: `US2 idempotent ${Date.now()} changed` }),
        idempotencyKey: key,
      });
      expect(conflicting.status).toBe(409);
      expect(problemCode(conflicting.body)).toBe("revision_conflict");

      const missingKey = await callApi("owner", "POST", "/teams", {
        body: command({ name: `US2 no key ${Date.now()}` }),
        idempotencyKey: null,
      });
      expect(missingKey.status).toBe(400);
      expect(problemCode(missingKey.body)).toBe("invalid_request");

      const missing = await callApi(
        "owner",
        "GET",
        "/workspaces/00000000-0000-7000-8000-000000000000",
      );
      expect(missing.status).toBe(404);
      const problem = asRecord(missing.body, "problem");
      expect(problem).toMatchObject({
        status: 404,
        code: "not_found",
        retryable: false,
      });
      expect(typeof problem.type).toBe("string");
      expect(typeof problem.title).toBe("string");
      expect(typeof problem.detail).toBe("string");
      expect(missing.text).not.toMatch(/PRIVATE_CANARY|at .*\.ts:\d+|stack/i);
    });

    it("accepts a Run with 202 while keeping the active configuration locked", async () => {
      const overview = await callApi("operator", "GET", `/workspaces/${fixture.workspaceId}`);
      const workspace = entity(overview.body, "workspace");
      const operatorEpoch = asRecord(workspace.currentOperator, "current operator").operatorEpoch;
      expect(typeof operatorEpoch).toBe("number");

      const key = newIdempotencyKey();
      const accepted = await startRun(
        "operator",
        fixture.workspaceId,
        operatorEpoch as number,
        "Start the US2 contract run",
        key,
      );
      expect(accepted.status).toBe(202);
      const run = entity(accepted.body, "run");
      const runId = idOf(run);
      expect(run.workspaceId).toBe(fixture.workspaceId);
      expect(["created", "running", "waiting_approval"]).toContain(run.state);
      expect(run.contextSnapshotId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const replay = await startRun(
        "operator",
        fixture.workspaceId,
        operatorEpoch as number,
        "Start the US2 contract run",
        key,
      );
      expect(replay.status).toBe(202);
      expect(idOf(entity(replay.body, "run"))).toBe(runId);

      const second = await startRun(
        "operator",
        fixture.workspaceId,
        operatorEpoch as number,
        "A different key must not create a second run",
      );
      expect(second.status).toBe(409);
      expect(problemCode(second.body)).toBe("task_active");

      const runs = await listRuns("operator", fixture.workspaceId);
      expect(activeRunId(runs)).toBe(runId);

      const version = revisionOf(workspace, "workspace");
      const locked = await callApi("owner", "PATCH", `/workspaces/${fixture.workspaceId}`, {
        headers: { "If-Match": ifMatch(version) },
        body: command({ runnerId: "00000000-0000-7000-8000-000000000000" }),
      });
      if (locked.status === 200) {
        expect(entity(locked.body, "workspace").runnerId).toBe(fixture.runnerId);
      } else {
        expect(locked.status).toBe(400);
        expect(problemCode(locked.body)).toBe("invalid_request");
      }
    });
  });
});
