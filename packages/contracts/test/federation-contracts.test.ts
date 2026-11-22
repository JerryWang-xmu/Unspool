import { describe, expect, it } from "vitest";
import { createB0FederationFixture } from "../../test-support/src/federation/fixtures.js";
import * as B1 from "../../test-support/src/federation/tool-fixtures.js";
import { DEFAULT_DATA_RIGHTS, reduceDataRights } from "../src/data-rights.js";
import { parseFederatedBetaEnabled, parseGrant, reduceGrant } from "../src/grant.js";
import { parseNodeArtifact } from "../src/node-artifact.js";
import { assertReceiptChain, detectReceiptGaps, nodeReceiptDigest } from "../src/node-receipt.js";
import { validateOperationTicket } from "../src/operation-ticket.js";
import {
  parsePatchProposal,
  patchProposalDigest,
  transitionPatchProposal,
} from "../src/patch-proposal.js";
import {
  parseRevocationDirective,
  revocationDirectivePrecedes,
} from "../src/revocation-directive.js";

describe("federation shared contracts", () => {
  it("keeps Beta and every right disabled by default and forbids expansion", async () => {
    expect(parseFederatedBetaEnabled(undefined)).toBe(false);
    expect(DEFAULT_DATA_RIGHTS).toMatchObject({
      modelDisclose: false,
      memberDisclose: false,
      publicTimeline: false,
      domainPropagate: false,
      centralCache: false,
      offlineRead: false,
    });
    expect(() => reduceDataRights(DEFAULT_DATA_RIGHTS, { modelDisclose: true })).toThrow();
    const fixture = await createB0FederationFixture();
    expect(() => reduceGrant(fixture.grants.active, { usageLimit: 99 })).toThrow(
      /usageLimit cannot expand/,
    );
    expect(parseGrant(fixture.grants.active).state).toBe("active");
    await fixture.cleanup();
  });

  it("validates ticket time, digest and replay boundaries", async () => {
    const fixture = await createB0FederationFixture();
    const ticket = fixture.tickets.valid;
    expect(
      validateOperationTicket(ticket, {
        now: fixture.now,
        grantDigest: ticket.grantDigest,
        recipientDigest: ticket.recipientDigest,
        bodyDigest: ticket.bodyDigest,
      }),
    ).toEqual(ticket);
    expect(() =>
      validateOperationTicket(ticket, {
        now: fixture.now,
        grantDigest: ticket.grantDigest,
        recipientDigest: ticket.recipientDigest,
        bodyDigest: ticket.bodyDigest,
        usedRequestIds: new Set([ticket.requestId]),
      }),
    ).toThrow(/ticket_replay_denied/);
    expect(() =>
      validateOperationTicket(fixture.tickets.expired, {
        now: fixture.now,
        grantDigest: fixture.tickets.expired.grantDigest,
        recipientDigest: fixture.tickets.expired.recipientDigest,
        bodyDigest: fixture.tickets.expired.bodyDigest,
      }),
    ).toThrow();
    await fixture.cleanup();
  });

  it("parses artifacts and detects receipt-chain gaps without using uploadState as identity", async () => {
    expect(parseNodeArtifact(B1.B1_NODE_ARTIFACT).contentDigest).toBe(
      B1.B1_NODE_ARTIFACT.contentDigest,
    );
    const fixture = await createB0FederationFixture();
    expect(nodeReceiptDigest(fixture.receipts.beforeGap)).toBe(
      nodeReceiptDigest({ ...fixture.receipts.beforeGap, uploadState: "duplicate" }),
    );
    expect(() => assertReceiptChain(fixture.receipts.beforeGap, fixture.receipts.afterGap)).toThrow(
      /receipt_chain_mismatch/,
    );
    expect(
      detectReceiptGaps([fixture.receipts.beforeGap, fixture.receipts.afterGap], fixture.now),
    ).toHaveLength(1);
    await fixture.cleanup();
  });

  it("orders revocations and rejects Patch terminal regression or traversal", () => {
    const older = parseRevocationDirective({
      id: "revoke-old",
      targetType: "node",
      targetId: "node-a",
      stateRevision: 1,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      reason: "old",
      scope: "local",
      ownerOrSecuritySignature: "signature",
    });
    const newer = parseRevocationDirective({ ...older, id: "revoke-new", stateRevision: 2 });
    expect(revocationDirectivePrecedes(newer, older)).toBe(true);
    expect(patchProposalDigest(B1.B1_PATCH_PROPOSAL)).toMatch(/^sha256:/);
    expect(() =>
      transitionPatchProposal({ ...B1.B1_PATCH_PROPOSAL, state: "applied" }, "proposed"),
    ).toThrow(/patch_terminal/);
    expect(() =>
      parsePatchProposal({
        ...B1.B1_PATCH_PROPOSAL,
        fileChanges: [{ ...B1.B1_PATCH_PROPOSAL.fileChanges[0]!, path: "../secret" }],
      }),
    ).toThrow(/patch_path_denied/);
  });
});
