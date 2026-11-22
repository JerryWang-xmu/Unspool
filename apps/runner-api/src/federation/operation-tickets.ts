import type {
  B0Grant,
  B0OperationTicket,
} from "../../../../packages/test-support/src/federation/fixtures.js";
import { MemoryTicketConsumptionStore, type TicketConsumptionStore } from "./ticket-store.js";

export interface TicketLease {
  readonly executionId: string;
  readonly requestId: string;
  readonly state: "accepted";
  readonly oneTime: true;
}

export class OperationTicketService {
  readonly #now: () => Date;
  readonly #store: TicketConsumptionStore;

  constructor(now: () => Date = () => new Date(), store?: TicketConsumptionStore) {
    this.#now = now;
    this.#store = store ?? new MemoryTicketConsumptionStore();
  }

  accept(input: {
    readonly ticket: B0OperationTicket;
    readonly grant: B0Grant;
    readonly recipientDigest: string;
    readonly bodyDigest: string;
    readonly grantDigest: string;
    readonly actionDigest: string;
    readonly verifyGrant: (grant: B0Grant) => boolean;
    readonly verifySignature: (ticket: B0OperationTicket) => boolean;
  }): TicketLease {
    const { ticket, grant } = input;
    if (ticket.nonce.length < 16) throw new Error("ticket_nonce_invalid");
    if (this.#store.hasRequest(ticket.requestId) || this.#store.hasNonce(ticket.nonce))
      throw new Error("ticket_replay_denied");
    if (this.#store.hasExecution(ticket.executionId)) throw new Error("ticket_lease_consumed");
    if (grant.state !== "active") throw new Error(`grant_${grant.state}`);
    if (ticket.nodeId !== grant.nodeId || ticket.runId !== grant.runId)
      throw new Error("ticket_scope_mismatch");
    if (!input.verifyGrant(grant)) throw new Error("grant_signature_invalid");
    if (
      !Number.isSafeInteger(grant.usageLimit) ||
      grant.usageLimit < 1 ||
      !Number.isSafeInteger(grant.budget.maxOperations) ||
      grant.budget.maxOperations < 1
    )
      throw new Error("grant_budget_invalid");
    const now = this.#now().getTime();
    if (!Number.isFinite(now)) throw new Error("ticket_time_invalid");
    if (
      !Number.isFinite(Date.parse(grant.notBefore)) ||
      !Number.isFinite(Date.parse(grant.expiresAt))
    )
      throw new Error("grant_time_invalid");
    if (Date.parse(grant.notBefore) > now) throw new Error("grant_not_yet_valid");
    if (Date.parse(grant.expiresAt) <= now) throw new Error("grant_expired");
    if (this.#store.usageCount(grant.id) >= Math.min(grant.usageLimit, grant.budget.maxOperations))
      throw new Error("grant_exhausted");
    if (ticket.grantDigest !== input.grantDigest) throw new Error("grant_digest_mismatch");
    if (ticket.actionDigest !== input.actionDigest) throw new Error("action_digest_mismatch");
    if (ticket.recipientDigest !== input.recipientDigest)
      throw new Error("recipient_digest_mismatch");
    if (ticket.bodyDigest !== input.bodyDigest) throw new Error("body_digest_mismatch");
    if (Date.parse(ticket.notBefore) > now) throw new Error("ticket_not_yet_valid");
    if (Date.parse(ticket.expiresAt) <= now) throw new Error("ticket_expired");
    if (
      !Number.isFinite(Date.parse(ticket.notBefore)) ||
      !Number.isFinite(Date.parse(ticket.expiresAt))
    )
      throw new Error("ticket_time_invalid");
    if (!input.verifySignature(ticket)) throw new Error("ticket_signature_invalid");
    this.#store.commit(ticket, grant, this.#now().toISOString());
    return {
      executionId: ticket.executionId,
      requestId: ticket.requestId,
      state: "accepted",
      oneTime: true,
    };
  }
}
