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

describe("US6 node pairing and operation tickets", () => {
  it("pairs once with unknown posture and no inbound listener, then rotates certificates", async () => {
    const { pairing } = await subject();
    const { value: code } = pairing.createCode("owner");
    const node = expectOk(pairing.complete("node-a", code.code));
    expect(node.securityPosture).toBe("unknown");
    expect(node.resources).toEqual([]);
    expect(node.inboundListener).toBe(false);
    expectError(pairing.complete("node-b", code.code), "pairing_code_invalid");
    const rotated = expectOk(pairing.rotate("node-a"));
    expect(rotated.certificateFingerprint).not.toBe(node.certificateFingerprint);
  });

  it("binds a ticket to its grant/body/recipient and rejects replay and terminal grants", async () => {
    const { fixture, tickets } = await subject();
    const accepted = expectOk(
      tickets.accept({
        ticket: fixture.tickets.valid,
        grant: fixture.grants.active,
        recipientDigest: fixture.tickets.valid.recipientDigest,
        bodyDigest: fixture.tickets.valid.bodyDigest,
      }),
    );
    expect(accepted.oneTime).toBe(true);
    expectError(
      tickets.accept({
        ticket: fixture.tickets.valid,
        grant: fixture.grants.active,
        recipientDigest: fixture.tickets.valid.recipientDigest,
        bodyDigest: fixture.tickets.valid.bodyDigest,
      }),
      "ticket_replay_denied",
    );
    expectError(
      tickets.accept({
        ticket: fixture.tickets.expired,
        grant: fixture.grants.expired,
        recipientDigest: fixture.tickets.expired.recipientDigest,
        bodyDigest: fixture.tickets.expired.bodyDigest,
      }),
      "grant_expired",
    );
    expectError(
      tickets.accept({
        ticket: fixture.tickets.revoked,
        grant: fixture.grants.revoked,
        recipientDigest: fixture.tickets.revoked.recipientDigest,
        bodyDigest: fixture.tickets.revoked.bodyDigest,
      }),
      "grant_revoked",
    );
  });
});
