import { describe, expect, it } from "vitest";
import { createPiActionProposal } from "../../pi-adapter/src/action-proposal.js";
import { type ActionEnvelope, computeActionDigest } from "../src/action-proposal.js";
import { classifyActionRisk, DEFAULT_RISK_POLICY } from "../src/risk-classifier.js";

describe("policy-driven action proposals", () => {
  it("keeps every Bash action high risk regardless of a read-only tool rule", () => {
    const result = classifyActionRisk(
      { toolName: "bash", canonicalArgs: { command: "cat report.md" } },
      { ...DEFAULT_RISK_POLICY, tools: { bash: { risk: "low", effect: "shell" } } },
    );
    expect(result).toMatchObject({
      risk: "high",
      requiresApproval: true,
      denied: false,
      effect: "shell",
    });
  });

  it("defaults unknown tools to approval and supports explicit deny policy", () => {
    const action = { toolName: "unknown_tool", canonicalArgs: {} };
    expect(classifyActionRisk(action)).toMatchObject({ risk: "high", requiresApproval: true });
    expect(
      classifyActionRisk(action, { ...DEFAULT_RISK_POLICY, unknownTool: "deny" }),
    ).toMatchObject({ denied: true, requiresApproval: false });
  });

  it("leaves explicitly known read-only tools low risk", () => {
    expect(
      classifyActionRisk({ toolName: "read_file", canonicalArgs: { path: "report.md" } }),
    ).toMatchObject({ risk: "low", requiresApproval: false });
  });

  it("redacts secrets without removing semantics while binding the digest to real bytes", () => {
    const action: ActionEnvelope = {
      toolName: "write_file",
      canonicalArgs: {
        path: "report.md",
        contents: "safe report",
        credential: "US1_SECRET_CANARY",
      },
      workingDirectory: "D:/workspace",
      environment: { API_TOKEN: "US1_TOKEN_CANARY" },
    };
    const { proposal } = createPiActionProposal({
      runId: "run-1",
      attemptId: "attempt-1",
      toolCallId: "tool-1",
      action,
      createdAt: "2026-11-22T10:00:00.000Z",
    });
    const display = JSON.stringify(proposal.displayArgs);
    expect(display).toContain("report.md");
    expect(display).toContain("safe report");
    expect(display).toContain("D:/workspace");
    expect(display).not.toContain("US1_SECRET_CANARY");
    expect(display).not.toContain("US1_TOKEN_CANARY");
    expect(proposal.secretRefs.length).toBeGreaterThanOrEqual(2);
    expect(proposal.secretRefs.join(" ")).not.toContain("CANARY");
    expect(proposal.actionDigest).toBe(computeActionDigest(action));
    expect(
      createPiActionProposal({
        runId: "run-1",
        attemptId: "attempt-1",
        toolCallId: "tool-1",
        action: {
          ...action,
          canonicalArgs: { path: "report.md", contents: "safe report", credential: "changed" },
        },
      }).proposal.actionDigest,
    ).not.toBe(proposal.actionDigest);
  });
});
