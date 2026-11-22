import { afterEach, describe, expect, it } from "vitest";
import { createFederationHarness } from "../../../packages/test-support/src/federation/harness.js";
import { expectError, expectOk } from "../../support/federation.js";

let harness: Awaited<ReturnType<typeof createFederationHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});
async function subject() {
  harness ??= await createFederationHarness();
  return harness;
}

describe("US6 fixed-tool sandbox", () => {
  it("executes only a schema-bound suite with empty environment and no network", async () => {
    const { tools, b1 } = await subject();
    expectOk(tools.register(b1.B1_FIXED_TOOL_TEMPLATE));
    const result = expectOk(
      tools.execute({
        template: b1.B1_FIXED_TOOL_TEMPLATE,
        templateDigest: b1.B1_FIXED_TOOL_TEMPLATE.digest,
        arguments: { suite: "unit" },
      }),
    );
    expect(result.state).toBe("succeeded");
    expect(result.environment).toEqual({});
    expect(result.networkAccesses).toBe(0);
    expect(result.shellInvocations).toBe(0);
    expect(tools.inspectSandbox(b1.B1_FIXED_TOOL_TEMPLATE).value).toMatchObject({
      networkPolicy: "disabled",
      shellInvocations: 0,
    });
  });

  it("rejects every arbitrary command, host override, and template mismatch before execution", async () => {
    const { tools, b1 } = await subject();
    for (const rejected of Object.values(b1.B1_FIXED_TOOL_REJECTED_INVOCATIONS)) {
      expectError(
        tools.execute({ ...rejected.request, template: b1.B1_FIXED_TOOL_TEMPLATE }),
        rejected.expectedErrorCode,
      );
    }
  });

  it("enforces output and process budgets without allowing self-elevation", async () => {
    const { tools, b1 } = await subject();
    expectError(
      tools.execute({
        template: b1.B1_FIXED_TOOL_TEMPLATE,
        templateDigest: b1.B1_FIXED_TOOL_TEMPLATE.digest,
        arguments: { suite: "unit" },
        usage: b1.B1_BUDGET_EXHAUSTION_SCENARIO.attemptedUsage,
      }),
      "budget_exhausted",
    );
  });
});
