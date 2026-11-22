import { DatabaseSync } from "node:sqlite";
import type {
  B0Grant,
  B0OperationTicket,
} from "../../../../packages/test-support/src/federation/fixtures.js";

export interface TicketConsumptionStore {
  hasRequest(requestId: string): boolean;
  hasNonce(nonce: string): boolean;
  hasExecution(executionId: string): boolean;
  usageCount(grantId: string): number;
  /** Final uniqueness and Grant-budget check, atomic with consumption. */
  commit(
    ticket: B0OperationTicket,
    grant: Pick<B0Grant, "id" | "usageLimit" | "budget">,
    consumedAt: string,
  ): void;
}

export class MemoryTicketConsumptionStore implements TicketConsumptionStore {
  readonly #requests = new Set<string>();
  readonly #nonces = new Set<string>();
  readonly #executions = new Set<string>();
  readonly #usage = new Map<string, number>();

  hasRequest(requestId: string): boolean {
    return this.#requests.has(requestId);
  }
  hasNonce(nonce: string): boolean {
    return this.#nonces.has(nonce);
  }
  hasExecution(executionId: string): boolean {
    return this.#executions.has(executionId);
  }
  usageCount(grantId: string): number {
    return this.#usage.get(grantId) ?? 0;
  }

  commit(
    ticket: B0OperationTicket,
    grant: Pick<B0Grant, "id" | "usageLimit" | "budget">,
    _consumedAt: string,
  ): void {
    if (this.#requests.has(ticket.requestId) || this.#nonces.has(ticket.nonce))
      throw new Error("ticket_replay_denied");
    if (this.#executions.has(ticket.executionId)) throw new Error("ticket_lease_consumed");
    if (this.usageCount(grant.id) >= Math.min(grant.usageLimit, grant.budget.maxOperations))
      throw new Error("grant_exhausted");
    this.#requests.add(ticket.requestId);
    this.#nonces.add(ticket.nonce);
    this.#executions.add(ticket.executionId);
    this.#usage.set(grant.id, this.usageCount(grant.id) + 1);
  }
}

export class SqliteTicketConsumptionStore implements TicketConsumptionStore {
  readonly #database: DatabaseSync;

  constructor(filename: string) {
    this.#database = new DatabaseSync(filename);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA foreign_keys = ON");
  }

  hasRequest(requestId: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 FROM federation_ticket_consumption WHERE request_id = ?")
        .get(requestId) !== undefined
    );
  }

  hasNonce(nonce: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 FROM federation_ticket_consumption WHERE nonce = ?")
        .get(nonce) !== undefined
    );
  }

  hasExecution(executionId: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 FROM federation_ticket_consumption WHERE execution_id = ?")
        .get(executionId) !== undefined
    );
  }

  usageCount(grantId: string): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM federation_ticket_consumption WHERE grant_id = ?")
      .get(grantId) as { count: number };
    return row.count;
  }

  commit(
    ticket: B0OperationTicket,
    grant: Pick<B0Grant, "id" | "usageLimit" | "budget">,
    consumedAt: string,
  ): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      if (this.hasRequest(ticket.requestId) || this.hasNonce(ticket.nonce))
        throw new Error("ticket_replay_denied");
      if (this.hasExecution(ticket.executionId)) throw new Error("ticket_lease_consumed");
      if (this.usageCount(grant.id) >= Math.min(grant.usageLimit, grant.budget.maxOperations))
        throw new Error("grant_exhausted");
      this.#database
        .prepare(
          "INSERT INTO federation_ticket_consumption (request_id, nonce, execution_id, grant_id, consumed_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(ticket.requestId, ticket.nonce, ticket.executionId, grant.id, consumedAt);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }
}
