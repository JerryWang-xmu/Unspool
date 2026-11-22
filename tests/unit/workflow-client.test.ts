import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunnerApiError } from "../../apps/desktop/src/api/runnerClient";
import { createWorkflowClient } from "../../apps/desktop/src/api/workflowClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fetchMock = vi.fn<typeof fetch>();

function makeClient() {
  return createWorkflowClient({
    baseUrl: "https://runner.test/v1",
    token: "test-token",
    fetchImpl: fetchMock,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problem(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

function call(index: number) {
  const entry = fetchMock.mock.calls[index];
  if (entry === undefined) throw new Error(`Expected fetch call ${index}.`);
  return entry;
}

function requestUrl(index: number): string {
  return String(call(index)[0]);
}

function requestHeaders(index: number): Headers {
  return new Headers(call(index)[1]?.headers);
}

function jsonBody(index: number): Record<string, unknown> {
  const body = call(index)[1]?.body;
  if (typeof body !== "string") throw new Error(`Expected fetch call ${index} to have a body.`);
  return JSON.parse(body) as Record<string, unknown>;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function expectCommand(index: number, canonicalPayload: string): Record<string, unknown> {
  const body = jsonBody(index);
  expect(call(index)[1]?.method).toBe("POST");
  expect(body.schemaVersion).toBe(1);
  expect(body.commandId).toMatch(UUID_PATTERN);
  expect(body.payloadDigest).toBe(sha256(canonicalPayload));
  expect(requestHeaders(index).get("idempotency-key")).toBe(String(body.commandId));
  expect(requestHeaders(index).get("content-type")).toBe("application/json");
  return body;
}

describe("WorkflowClient HTTP protocol", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("uses bearer auth, omits cookies, and keeps GET requests free of idempotency keys", async () => {
    const team = {
      id: "team-1",
      name: "Release",
      betaEnabled: false,
      defaultPolicyRevision: 1,
      revision: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      ownerId: null,
    };
    fetchMock
      .mockResolvedValueOnce(json({ principal: { id: "user-1", displayName: "Ada Lovelace" } }))
      .mockResolvedValueOnce(json({ teams: [team] }));

    const client = makeClient();
    await expect(client.getMe()).resolves.toEqual({
      id: "user-1",
      displayName: "Ada Lovelace",
    });
    await expect(client.listTeams()).resolves.toEqual([team]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0)).toBe("https://runner.test/v1/me");
    expect(requestUrl(1)).toBe("https://runner.test/v1/teams");
    for (const index of [0, 1]) {
      expect(call(index)[1]?.method).toBe("GET");
      expect(call(index)[1]?.credentials).toBe("omit");
      expect(call(index)[1]?.body).toBeNull();
      expect(requestHeaders(index).get("authorization")).toBe("Bearer test-token");
      expect(requestHeaders(index).get("cookie")).toBeNull();
      expect(requestHeaders(index).get("idempotency-key")).toBeNull();
    }
  });

  it("wraps handoff commands in canonical envelopes and applies If-Match to acceptance", async () => {
    const invitation = {
      id: "handoff-1",
      workspaceId: "ws-1",
      fromOperatorId: "user-1",
      recipientId: "user-2",
      summarySnapshotId: "summary-1",
      baseRevision: 1,
      status: "invited",
      reason: "Need coverage",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const preparation = {
      id: "preparation-1",
      handoffId: "handoff-1",
      recipientId: "user-2",
      status: "preparing",
      readOnlyConversationId: "conversation-1",
      asOfRevision: 1,
      latestRevision: 2,
      startedAt: "2026-01-01T00:00:00.000Z",
      summary: { id: "summary-1", revision: 1 },
    };
    const answer = {
      id: "qa-1",
      question: "What changed?",
      answer: "The release scope changed.",
      answerKind: "cited",
      asOfRevision: 3,
      citations: [{ sourceType: "context", sourceId: "version-1", sourceRevision: 2 }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const refreshed = {
      refreshedAt: "2026-01-01T00:00:00.000Z",
      latestRecordedAt: "2026-01-01T00:00:00.000Z",
      latestRevision: 3,
      asOfRevision: 1,
      changed: true,
      goal: "Ship the release",
      unresolvedIssues: [],
    };
    const acceptance = {
      id: "handoff-1",
      status: "accepted",
      acceptedAt: "2026-01-01T00:00:00.000Z",
      operatorId: "user-2",
      previousOperatorId: "user-1",
      operatorEpoch: 2,
    };
    const rejection = { id: "handoff-1", status: "rejected", reason: "Not available" };

    fetchMock
      .mockResolvedValueOnce(json(invitation, 201))
      .mockResolvedValueOnce(json(preparation, 201))
      .mockResolvedValueOnce(json(preparation))
      .mockResolvedValueOnce(json(answer))
      .mockResolvedValueOnce(json(refreshed))
      .mockResolvedValueOnce(json(acceptance))
      .mockResolvedValueOnce(json(rejection));

    const client = makeClient();
    await expect(
      client.inviteHandoff("ws-1", { recipientId: "user-2", reason: "Need coverage" }),
    ).resolves.toEqual(invitation);
    await expect(client.prepareHandoff("ws-1", "handoff-1")).resolves.toEqual(preparation);
    await expect(client.getPreparation("ws-1", "handoff-1")).resolves.toEqual(preparation);
    await expect(
      client.askHandoffQuestion("ws-1", "handoff-1", {
        question: "What changed?",
        asOfRevision: 3,
      }),
    ).resolves.toEqual(answer);
    await expect(client.refreshHandoff("ws-1", "handoff-1")).resolves.toEqual(refreshed);
    await expect(client.acceptHandoff("ws-1", "handoff-1", 7)).resolves.toEqual(acceptance);
    await expect(client.rejectHandoff("ws-1", "handoff-1", "Not available")).resolves.toEqual(
      rejection,
    );

    expect(requestUrl(0)).toBe("https://runner.test/v1/workspaces/ws-1/handoffs");
    expect(requestUrl(1)).toBe("https://runner.test/v1/workspaces/ws-1/handoffs/handoff-1/prepare");
    expect(requestUrl(2)).toBe(
      "https://runner.test/v1/workspaces/ws-1/handoffs/handoff-1/preparation",
    );
    expect(requestUrl(3)).toBe(
      "https://runner.test/v1/workspaces/ws-1/handoffs/handoff-1/questions",
    );
    expect(requestUrl(4)).toBe("https://runner.test/v1/workspaces/ws-1/handoffs/handoff-1/refresh");
    expect(requestUrl(5)).toBe("https://runner.test/v1/workspaces/ws-1/handoffs/handoff-1/accept");
    expect(requestUrl(6)).toBe("https://runner.test/v1/workspaces/ws-1/handoffs/handoff-1/reject");

    expect(expectCommand(0, '{"reason":"Need coverage","recipientId":"user-2"}')).toMatchObject({
      recipientId: "user-2",
      reason: "Need coverage",
    });
    expect(expectCommand(1, "{}")).toMatchObject({
      schemaVersion: 1,
      commandId: expect.any(String),
      payloadDigest: sha256("{}"),
    });
    expect(Object.keys(jsonBody(1)).sort()).toEqual([
      "commandId",
      "payloadDigest",
      "schemaVersion",
    ]);
    expect(call(2)[1]?.method).toBe("GET");
    expect(call(2)[1]?.body).toBeNull();
    expect(requestHeaders(2).get("idempotency-key")).toBeNull();
    expect(expectCommand(3, '{"asOfRevision":3,"question":"What changed?"}')).toMatchObject({
      question: "What changed?",
      asOfRevision: 3,
    });
    expect(expectCommand(4, "{}")).toMatchObject({
      payloadDigest: sha256("{}"),
    });
    expect(expectCommand(5, "{}")).toMatchObject({
      payloadDigest: sha256("{}"),
    });
    expect(expectCommand(6, '{"reason":"Not available"}')).toMatchObject({
      reason: "Not available",
    });

    for (const index of [0, 1, 3, 4, 6]) {
      expect(requestHeaders(index).get("if-match")).toBeNull();
    }
    expect(requestHeaders(5).get("if-match")).toBe('"7"');
  });

  it("parses conclusion lists, proposals and append-only reviews", async () => {
    const conclusion = {
      id: "conclusion-1",
      workspaceId: "ws-1",
      kind: "fact",
      body: "Rate < 5%",
      state: "unverified",
      scope: "release",
      proposedBy: "user-1",
      currentVersion: 1,
      sourceVersionIds: ["sv-2", "sv-1"],
    };
    const review = {
      id: "review-1",
      conclusionId: "conclusion-1",
      previousState: "unverified",
      newState: "confirmed",
      reason: "Sources checked",
      sourceVersionIds: ["sv-1"],
      reviewedBy: "user-3",
      reviewedAt: "2026-01-01T00:00:00.000Z",
    };
    const reviewedConclusion = {
      ...conclusion,
      state: "confirmed",
      currentVersion: 2,
      sourceVersionIds: ["sv-1"],
      confirmedBy: "user-3",
      confirmedAt: "2026-01-01T00:00:00.000Z",
    };
    const invalidReview = {
      ...review,
      id: "review-2",
      previousState: "confirmed",
      newState: "invalid",
      reason: "No source",
    };

    fetchMock
      .mockResolvedValueOnce(json({ items: [conclusion] }))
      .mockResolvedValueOnce(json(conclusion, 201))
      .mockResolvedValueOnce(json({ conclusion: reviewedConclusion, review }))
      .mockResolvedValueOnce(json({ items: [review] }))
      .mockResolvedValueOnce(json({ conclusion: reviewedConclusion, review: invalidReview }));

    const client = makeClient();
    await expect(client.listConclusions("ws-1")).resolves.toEqual([conclusion]);
    await expect(
      client.proposeConclusion("ws-1", {
        kind: "fact",
        body: "Rate < 5%",
        scope: "release",
        sourceVersionIds: ["sv-2", "sv-1"],
      }),
    ).resolves.toEqual(conclusion);
    await expect(
      client.reviewConclusion("ws-1", "conclusion-1", {
        newState: "confirmed",
        reason: "Sources checked",
        sourceVersionIds: ["sv-1"],
      }),
    ).resolves.toEqual({ conclusion: reviewedConclusion, review });
    await expect(client.listReviewHistory("ws-1", "conclusion-1")).resolves.toEqual([review]);
    await expect(
      client.reviewConclusion("ws-1", "conclusion-1", {
        newState: "invalid",
        reason: "No source",
      }),
    ).resolves.toEqual({ conclusion: reviewedConclusion, review: invalidReview });

    expect(requestUrl(0)).toBe("https://runner.test/v1/workspaces/ws-1/conclusions");
    expect(call(0)[1]?.method).toBe("GET");
    expect(requestHeaders(0).get("idempotency-key")).toBeNull();
    expect(
      expectCommand(
        1,
        '{"body":"Rate < 5%","kind":"fact","scope":"release","sourceVersionIds":["sv-2","sv-1"]}',
      ),
    ).toMatchObject({
      body: "Rate < 5%",
      kind: "fact",
      scope: "release",
      sourceVersionIds: ["sv-2", "sv-1"],
    });
    expect(requestUrl(2)).toBe(
      "https://runner.test/v1/workspaces/ws-1/conclusions/conclusion-1/review",
    );
    expect(
      expectCommand(
        2,
        '{"newState":"confirmed","reason":"Sources checked","sourceVersionIds":["sv-1"]}',
      ),
    ).toMatchObject({
      newState: "confirmed",
      reason: "Sources checked",
      sourceVersionIds: ["sv-1"],
    });
    expect(requestUrl(3)).toBe(
      "https://runner.test/v1/workspaces/ws-1/conclusions/conclusion-1/reviews",
    );
    expect(call(3)[1]?.method).toBe("GET");
    expect(requestHeaders(3).get("idempotency-key")).toBeNull();
    expect(expectCommand(4, '{"newState":"invalid","reason":"No source"}')).not.toHaveProperty(
      "sourceVersionIds",
    );
  });

  it("parses archive exports, direct manifests, and encoded archive searches", async () => {
    const archiveExport = {
      id: "export-1",
      workspaceId: "ws-1",
      scope: "selected_tasks",
      formatVersion: 1,
      manifestBlobId: "blob-1",
      missingItems: [],
      unknownItems: [],
      exportedBy: "user-1",
      exportedAt: "2026-01-01T00:00:00.000Z",
    };
    const manifest = {
      formatVersion: 1,
      scope: "selected_tasks",
      runs: [{ id: "run-1", state: "completed" }],
      artifacts: [],
    };
    const artifact = {
      id: "artifact-1",
      name: "release-notes.md",
      sha256: `sha256:${"a".repeat(64)}`,
      size: 42,
      path: "artifacts/artifact-1",
      status: "present",
    };

    fetchMock
      .mockResolvedValueOnce(json({ items: [archiveExport] }))
      .mockResolvedValueOnce(json(archiveExport, 201))
      .mockResolvedValueOnce(json(manifest))
      .mockResolvedValueOnce(json({ conclusions: [], artifacts: [artifact] }));

    const client = makeClient();
    await expect(client.listArchiveExports("ws-1")).resolves.toEqual([archiveExport]);
    await expect(
      client.createArchiveExport("ws-1", { scope: "selected_tasks", runIds: ["run-1"] }),
    ).resolves.toEqual(archiveExport);
    await expect(client.getArchiveManifest("ws-1", "export-1")).resolves.toEqual(manifest);
    await expect(client.searchArchive("ws-1", "release notes & risks")).resolves.toEqual({
      conclusions: [],
      artifacts: [artifact],
    });

    expect(call(0)[1]?.method).toBe("GET");
    expect(requestUrl(0)).toBe("https://runner.test/v1/workspaces/ws-1/archive-exports");
    expect(requestHeaders(0).get("idempotency-key")).toBeNull();
    expect(expectCommand(1, '{"runIds":["run-1"],"scope":"selected_tasks"}')).toMatchObject({
      scope: "selected_tasks",
      runIds: ["run-1"],
    });
    expect(requestUrl(1)).toBe("https://runner.test/v1/workspaces/ws-1/archive-exports");
    expect(call(2)[1]?.method).toBe("GET");
    expect(requestUrl(2)).toBe(
      "https://runner.test/v1/workspaces/ws-1/archive-exports/export-1/manifest",
    );
    expect(requestHeaders(2).get("idempotency-key")).toBeNull();
    expect(call(3)[1]?.method).toBe("GET");
    expect(requestUrl(3)).toBe(
      "https://runner.test/v1/workspaces/ws-1/archive-search?q=release%20notes%20%26%20risks",
    );
    expect(requestHeaders(3).get("idempotency-key")).toBeNull();
  });

  it("archives with If-Match and assesses completion with evidence exceptions", async () => {
    const archived = {
      id: "ws-1",
      name: "Release",
      status: "archived",
      revision: 5,
      archivedAt: "2026-01-01T00:00:00.000Z",
    };
    const assessment = {
      assessment: {
        runId: "run-1",
        result: "complete",
        assessedBy: "user-1",
        assessedAt: "2026-01-01T00:00:00.000Z",
        evidenceExceptionId: "exception-1",
      },
      coverage: { validEvidence: 0, requiredEvidence: 1, ratio: 0, exceptionCounted: false },
      blockingConclusionIds: ["conclusion-1"],
      exception: {
        id: "exception-1",
        runId: "run-1",
        conclusionIds: ["conclusion-1"],
        reason: "Owner accepted risk",
        approvedBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };

    fetchMock
      .mockResolvedValueOnce(json({ ...archived, workspace: archived }))
      .mockResolvedValueOnce(json(assessment));

    const client = makeClient();
    await expect(client.archiveWorkspace("ws-1", 4)).resolves.toEqual(archived);
    await expect(
      client.assessCompletion("ws-1", {
        runId: "run-1",
        result: "complete",
        evidenceExceptionReason: "Owner accepted risk",
      }),
    ).resolves.toEqual(assessment);

    expect(expectCommand(0, "{}")).toMatchObject({ payloadDigest: sha256("{}") });
    expect(requestUrl(0)).toBe("https://runner.test/v1/workspaces/ws-1/archive");
    expect(requestHeaders(0).get("if-match")).toBe('"4"');
    expect(
      expectCommand(
        1,
        '{"evidenceExceptionReason":"Owner accepted risk","result":"complete","runId":"run-1"}',
      ),
    ).toMatchObject({
      runId: "run-1",
      result: "complete",
      evidenceExceptionReason: "Owner accepted risk",
    });
    expect(requestUrl(1)).toBe("https://runner.test/v1/workspaces/ws-1/completion-assessments");
    expect(requestHeaders(1).get("if-match")).toBeNull();
    expect(jsonBody(1)).not.toHaveProperty("reason");
  });

  it("produces a stable payload digest regardless of business payload key order", async () => {
    const conclusion = {
      id: "conclusion-1",
      workspaceId: "ws-1",
      kind: "fact",
      body: "same",
      state: "unverified",
      scope: "s",
      proposedBy: "user-1",
      currentVersion: 1,
      sourceVersionIds: ["sv-1"],
    };
    fetchMock
      .mockResolvedValueOnce(json(conclusion, 201))
      .mockResolvedValueOnce(json(conclusion, 201));

    const client = makeClient();
    await client.proposeConclusion("ws-1", {
      kind: "fact",
      body: "same",
      scope: "s",
      sourceVersionIds: ["sv-1"],
    });
    await client.proposeConclusion("ws-1", {
      sourceVersionIds: ["sv-1"],
      scope: "s",
      body: "same",
      kind: "fact",
    });

    const first = expectCommand(
      0,
      '{"body":"same","kind":"fact","scope":"s","sourceVersionIds":["sv-1"]}',
    );
    const second = expectCommand(
      1,
      '{"body":"same","kind":"fact","scope":"s","sourceVersionIds":["sv-1"]}',
    );
    expect(second.payloadDigest).toBe(first.payloadDigest);
    expect(second.commandId).not.toBe(first.commandId);
    expect(requestHeaders(1).get("idempotency-key")).not.toBe(
      requestHeaders(0).get("idempotency-key"),
    );
  });

  it("preserves an unknown problem code and retryability from a Problem response", async () => {
    const detail = "The outcome is unknown; reconcile before retrying.";
    fetchMock.mockResolvedValueOnce(
      problem(
        {
          type: "https://unspool.dev/problems/future-outcome-unknown",
          title: "Unknown outcome",
          status: 409,
          code: "future_outcome_unknown",
          detail,
          retryable: true,
        },
        409,
      ),
    );

    let caught: unknown;
    try {
      await makeClient().listConclusions("ws-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RunnerApiError);
    expect(caught).toMatchObject({
      name: "RunnerApiError",
      message: detail,
      status: 409,
      code: "future_outcome_unknown",
      retryable: true,
    });
  });
});
