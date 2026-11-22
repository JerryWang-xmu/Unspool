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

describe("US6 owner-signed Grant lifecycle", () => {
  it("approves with a verifiable owner signature, narrows, and revokes locally", async () => {
    const { fixture, grants } = await subject();
    expectOk(grants.registerOwner(fixture.grants.active.ownerId));
    const pending = expectOk(
      grants.propose({
        ...fixture.grants.active,
        state: undefined,
        ownerSignature: undefined,
        revocationTombstone: undefined,
      }),
    );
    const active = expectOk(grants.decide(pending.id, "active"));
    expect(active.state).toBe("active");
    expect(grants.verify(active.id).value).toBe(true);
    const narrowed = expectOk(
      grants.decide(active.id, "active", { operations: ["snapshot.read"], usageLimit: 1 }),
    );
    expect(narrowed.usageLimit).toBe(1);
    expectError(grants.decide(active.id, "active", { usageLimit: 99 }), "grant_expansion_denied");
    const revoked = expectOk(grants.decide(active.id, "revoked"));
    expect(revoked.state).toBe("revoked");
    expect(revoked.revocationTombstone).toBeTypeOf("string");
    expect(grants.verify(revoked.id).value).toBe(false);
  });

  it("expires at the local deadline and never revives a terminal grant", async () => {
    const { fixture, grants } = await subject();
    expectOk(grants.registerOwner(fixture.grants.active.ownerId));
    const pending = expectOk(
      grants.propose({
        ...fixture.grants.expired,
        state: undefined,
        ownerSignature: undefined,
        revocationTombstone: undefined,
      }),
    );
    expectOk(grants.decide(pending.id, "active"));
    expect(grants.get(pending.id).value.state).toBe("expired");
    expectError(grants.decide(pending.id, "active"), "grant_terminal");
  });
});
