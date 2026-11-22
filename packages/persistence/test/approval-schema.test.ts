import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const SCHEMA_DIR = resolve(import.meta.dirname, "../schema");

const APPROVAL_SCHEMAS = [
  "action-proposal.sql",
  "approval-request.sql",
  "approval-decision.sql",
  "execution-permit.sql",
] as const;

function createSchemaDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");

  for (const file of APPROVAL_SCHEMAS) {
    database.exec(readFileSync(resolve(SCHEMA_DIR, file), "utf8"));
  }

  return database;
}

function columnsOf(database: DatabaseSync, table: string): string[] {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String((column as { name: unknown }).name));
}

describe("approval persistence schema", () => {
  it("creates every canonical approval table and column", () => {
    const database = createSchemaDatabase();
    try {
      expect(columnsOf(database, "action_proposal")).toEqual([
        "id",
        "run_id",
        "attempt_id",
        "tool_call_id",
        "tool_name",
        "canonical_args",
        "display_args",
        "secret_refs",
        "action_digest",
        "purpose",
        "impact",
        "risk",
        "base_resource_versions",
        "created_at",
      ]);

      expect(columnsOf(database, "approval_request")).toEqual([
        "id",
        "action_proposal_id",
        "requester_id",
        "required_approver_policy",
        "state",
        "expires_at",
        "policy_revision",
        "created_at",
      ]);

      expect(columnsOf(database, "approval_decision")).toEqual([
        "id",
        "approval_request_id",
        "decision",
        "decided_by",
        "reason",
        "decided_at",
        "action_digest",
      ]);

      expect(columnsOf(database, "execution_permit")).toEqual([
        "id",
        "approval_decision_id",
        "action_digest",
        "run_attempt_id",
        "policy_revision",
        "expires_at",
        "consumed_at",
        "consumption_result",
      ]);
    } finally {
      database.close();
    }
  });
});
