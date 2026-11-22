import { describe, expect, it } from "vitest";
import { createCitation } from "../src/citation.js";
import { createClarificationPublication } from "../src/clarification-publication.js";
import { createHandoffInvitation } from "../src/handoff-invitation.js";
import { createHandoffSummary } from "../src/handoff-summary.js";
import { createPreparationSession } from "../src/preparation-session.js";
import { createPrivateQA } from "../src/private-qa.js";
import { createUnresolvedIssue } from "../src/unresolved-issue.js";

const NOW = "2026-11-22T10:00:00.000Z";
const ids = {
  workspaceId: "workspace",
  fromOperatorId: "operator",
  recipientId: "recipient",
  summarySnapshotId: "summary",
  baseRevision: 1,
  createdAt: NOW,
};

describe("US4 handoff models", () => {
  it("starts invited with an immutable complete summary", () => {
    expect(createHandoffInvitation({ id: "handoff", ...ids }).status).toBe("invited");
    const summary = createHandoffSummary({
      id: "summary",
      workspaceId: "workspace",
      revision: 1,
      goal: "goal",
      criteria: "criteria",
      runState: "running",
      decisions: ["decision"],
      pendingApprovalIds: ["approval"],
    });
    expect(summary.decisions).toEqual(["decision"]);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.decisions)).toBe(true);
  });

  it("keeps preparation read-only revisions ordered", () => {
    expect(
      createPreparationSession({
        id: "preparation",
        handoffId: "handoff",
        recipientId: "recipient",
        readOnlyConversationId: "conversation",
        asOfRevision: 2,
        latestRevision: 3,
        startedAt: NOW,
      }),
    ).toMatchObject({ status: "preparing", asOfRevision: 2, latestRevision: 3 });
    expect(() =>
      createPreparationSession({
        id: "preparation",
        handoffId: "handoff",
        recipientId: "recipient",
        readOnlyConversationId: "conversation",
        asOfRevision: 3,
        latestRevision: 2,
        startedAt: NOW,
      }),
    ).toThrow(RangeError);
  });

  it("preserves explicit answer kinds, citations and private-by-default issues", () => {
    expect(
      createPrivateQA({
        id: "qa",
        preparationSessionId: "preparation",
        question: "question",
        answer: "unknown",
        asOfRevision: 1,
        answerKind: "unknown",
        createdAt: NOW,
      }).answerKind,
    ).toBe("unknown");
    expect(() =>
      createPrivateQA({
        id: "qa",
        preparationSessionId: "preparation",
        question: "question",
        answer: "answer",
        asOfRevision: 1,
        answerKind: "guessed" as never,
        createdAt: NOW,
      }),
    ).toThrow(TypeError);
    expect(
      createCitation({
        privateQAId: "qa",
        sourceType: "context",
        sourceId: "version",
        sourceRevision: 2,
        recordedAt: NOW,
      }),
    ).toMatchObject({ sourceRevision: 2 });
    expect(
      createUnresolvedIssue({
        id: "issue",
        preparationSessionId: "preparation",
        body: "open question",
      }),
    ).toMatchObject({ visibility: "private", status: "open" });
  });

  it("keeps published clarifications separate and immutable", () => {
    const publication = createClarificationPublication({
      id: "publication",
      preparationSessionId: "preparation",
      targetType: "context",
      targetId: "target",
      editedBody: "edited",
      publishedBy: "recipient",
      publishedAt: NOW,
    });
    expect(publication.editedBody).toBe("edited");
    expect(Object.isFrozen(publication)).toBe(true);
  });
});
