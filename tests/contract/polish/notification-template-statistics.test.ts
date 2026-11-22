import { describe, expect, it } from "vitest";
import { NotificationService } from "../../../apps/runner-api/src/notifications/service.js";
import { StatisticsService } from "../../../apps/runner-api/src/statistics/service.js";
import { TemplateService } from "../../../apps/runner-api/src/templates/service.js";

describe("Polish notifications, templates and statistics", () => {
  it("delivers required notification types without exposing private preparation bodies", () => {
    const service = new NotificationService();
    for (const type of [
      "approval",
      "handoff",
      "mention",
      "completion",
      "failure",
      "needs_confirmation",
    ] as const) {
      service.publish({
        type,
        workspaceId: "workspace",
        actorId: "owner",
        title: type,
        visibility: "workspace_members",
      });
    }
    service.publish({
      type: "handoff",
      workspaceId: "workspace",
      actorId: "owner",
      title: "private",
      body: "PRIVATE_QUESTION",
      visibility: "private",
      recipientIds: ["recipient"],
    });
    expect(service.list("workspace", "owner").map((item) => item.type)).toHaveLength(6);
    expect(JSON.stringify(service.list("workspace", "owner"))).not.toContain("PRIVATE_QUESTION");
  });

  it("reuses goal, context and approval task templates", () => {
    const service = new TemplateService();
    const template = service.create({
      name: "Reviewed task",
      goal: "Ship evidence",
      context: [{ title: "Source", body: "Evidence" }],
      approvalPolicy: { required: true, approverIds: ["owner"] },
    });
    expect(service.instantiate(template.id).goal).toBe("Ship evidence");
    expect(service.instantiate(template.id).approvalPolicy.required).toBe(true);
  });

  it("computes duration, collaboration, handoff, approval and reliable-cost statistics", () => {
    const service = new StatisticsService();
    const result = service.summarize({
      runs: [
        {
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:10:00.000Z",
          state: "technical_complete",
        },
      ],
      effectiveActions: [
        { actorId: "owner", kind: "discussion" },
        { actorId: "operator", kind: "suggestion" },
      ],
      handoffs: [{ startedAt: "2026-01-01T00:00:00.000Z", acceptedAt: "2026-01-01T00:05:00.000Z" }],
      approvals: [{ createdAt: "2026-01-01T00:00:00.000Z", decidedAt: "2026-01-01T00:01:00.000Z" }],
      usage: [
        { provider: "faux", costAmount: 2, reliability: "reliable" },
        { provider: "other", costAmount: 100, reliability: "unavailable" },
      ],
    });
    expect(result.runDurationMs).toBe(600_000);
    expect(result.effectiveMemberCount).toBe(2);
    expect(result.handoffDurationMs).toBe(300_000);
    expect(result.approvalDurationMs).toBe(60_000);
    expect(result.reliableCostAmount).toBe(2);
    expect(result.costReliability).toBe("reliable");
  });
});
