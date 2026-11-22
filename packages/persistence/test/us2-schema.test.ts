import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const SCHEMA_FILES = [
  "team.sql",
  "membership.sql",
  "context-item.sql",
  "context-version.sql",
] as const;

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL) STRICT");
  database.exec("CREATE TABLE workspace (id TEXT PRIMARY KEY NOT NULL) STRICT");
  for (const file of SCHEMA_FILES) {
    database.exec(readFileSync(new URL(`../schema/${file}`, import.meta.url), "utf8"));
  }
  return database;
}

const NOW = "2026-11-22T00:00:00.000Z";
const ATTRIBUTION = JSON.stringify({
  actorId: "user-1",
  displayNameAtTime: "Ada",
  rolesAtTime: ["member"],
  occurredAt: NOW,
});

describe("US2 SQLite schemas", () => {
  it("defaults Beta off and membership active, with team-scoped uniqueness", () => {
    const database = createDatabase();
    try {
      database
        .prepare("INSERT INTO team (id, name, created_at) VALUES (?, ?, ?)")
        .run("team-1", "Research", NOW);
      const team = database
        .prepare(
          "SELECT beta_enabled AS betaEnabled, default_policy_revision AS revision FROM team",
        )
        .get();
      expect(team).toMatchObject({ betaEnabled: 0, revision: 1 });

      database.exec("INSERT INTO user (id) VALUES ('user-1')");
      database
        .prepare(
          "INSERT INTO membership (id, team_id, user_id, team_roles, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("membership-1", "team-1", "user-1", '["member"]', "2026-12-01T00:00:00.000Z");
      const membership = database
        .prepare("SELECT status, expires_at AS expiresAt FROM membership")
        .get();
      expect(membership).toMatchObject({ status: "active", expiresAt: "2026-12-01T00:00:00.000Z" });

      expect(() =>
        database
          .prepare("INSERT INTO membership (id, team_id, user_id, team_roles) VALUES (?, ?, ?, ?)")
          .run("membership-2", "team-1", "user-1", '["member"]'),
      ).toThrow(/UNIQUE/);
    } finally {
      database.close();
    }
  });

  it("enforces immutable context versions and complete attribution", () => {
    const database = createDatabase();
    try {
      database.exec(
        `INSERT INTO team (id, name, created_at) VALUES ('team-1', 'Research', '${NOW}')`,
      );
      database.exec("INSERT INTO user (id) VALUES ('user-1')");
      database.exec("INSERT INTO workspace (id) VALUES ('workspace-1')");
      database.exec("BEGIN");
      database.exec(
        `INSERT INTO context_item (id, workspace_id, kind, current_version_id, created_by, created_at)
         VALUES ('item-1', 'workspace-1', 'goal', 'version-1', 'user-1', '${NOW}')`,
      );
      database
        .prepare(
          `INSERT INTO context_version
            (id, context_item_id, version, title, body, member_visibility, agent_exposure, attribution)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("version-1", "item-1", 1, "Goal", "Ship it", "members", "not_provided", ATTRIBUTION);
      database.exec("COMMIT");

      expect(() =>
        database.exec("UPDATE context_version SET title = 'Changed' WHERE id = 'version-1'"),
      ).toThrow(/immutable/);
      expect(() => database.exec("DELETE FROM context_version WHERE id = 'version-1'")).toThrow(
        /history/,
      );
      expect(() => database.exec("DELETE FROM context_item WHERE id = 'item-1'")).toThrow(
        /removed by state/,
      );
      expect(() =>
        database
          .prepare(
            `INSERT INTO context_version
              (id, context_item_id, version, title, body, member_visibility, agent_exposure, attribution)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "version-2",
            "item-1",
            2,
            "Goal",
            "Ship it",
            "members",
            "not_provided",
            JSON.stringify({ actorId: "user-1" }),
          ),
      ).toThrow(/CHECK/);
      expect(() =>
        database
          .prepare(
            `INSERT INTO context_version
              (id, context_item_id, version, title, body, member_visibility, agent_exposure, attribution)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run("version-3", "item-1", 1, "Goal", "Ship it", "members", "not_provided", ATTRIBUTION),
      ).toThrow(/UNIQUE/);
    } finally {
      database.close();
    }
  });
});
