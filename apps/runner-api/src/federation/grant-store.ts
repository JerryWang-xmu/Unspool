import { createHash, createPublicKey } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FederationGrant } from "./grant-service.js";

interface OwnerKeyRecord {
  readonly publicKey: string;
  readonly privateKey: string;
}

export class FederationGrantStore {
  readonly #database: DatabaseSync;
  readonly #keysDirectory: string;

  constructor(filename: string, keysDirectory: string) {
    this.#database = new DatabaseSync(filename);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#keysDirectory = keysDirectory;
    mkdirSync(keysDirectory, { recursive: true, mode: 0o700 });
    chmodSync(keysDirectory, 0o700);
  }

  close(): void {
    this.#database.close();
  }

  loadGrants(): FederationGrant[] {
    const rows = this.#database.prepare("SELECT grant_json FROM federation_grant_state").all() as {
      grant_json: string;
    }[];
    return rows.map((row) => JSON.parse(row.grant_json) as FederationGrant);
  }

  saveGrant(grant: FederationGrant, expectedState?: FederationGrant["state"]): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const updatedAt = new Date().toISOString();
      if (expectedState === undefined) {
        this.#database
          .prepare(
            "INSERT INTO federation_grant_state (id, grant_json, state, updated_at) VALUES (?, ?, ?, ?)",
          )
          .run(grant.id, JSON.stringify(grant), grant.state, updatedAt);
      } else {
        const result = this.#database
          .prepare(
            "UPDATE federation_grant_state SET grant_json = ?, state = ?, updated_at = ? WHERE id = ? AND state = ?",
          )
          .run(JSON.stringify(grant), grant.state, updatedAt, grant.id, expectedState);
        if (result.changes !== 1) throw new Error("grant_terminal");
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listOwnerIds(): string[] {
    const rows = this.#database.prepare("SELECT owner_id FROM federation_owner_key").all() as {
      owner_id: string;
    }[];
    return rows.map((row) => row.owner_id);
  }

  loadOwner(ownerId: string): OwnerKeyRecord | undefined {
    const row = this.#database
      .prepare("SELECT public_key, private_key_ref FROM federation_owner_key WHERE owner_id = ?")
      .get(ownerId) as { public_key: string; private_key_ref: string } | undefined;
    if (row === undefined) return undefined;
    return { publicKey: row.public_key, privateKey: readFileSync(row.private_key_ref, "utf8") };
  }

  saveOwner(ownerId: string, record: OwnerKeyRecord): OwnerKeyRecord {
    const reference = join(
      this.#keysDirectory,
      `${createHash("sha256").update(ownerId).digest("hex")}.key`,
    );
    try {
      writeFileSync(reference, record.privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
      chmodSync(reference, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const privateKey = readFileSync(reference, "utf8");
    const publicKey = createPublicKey(privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    this.#database
      .prepare(
        "INSERT INTO federation_owner_key (owner_id, public_key, private_key_ref, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING",
      )
      .run(ownerId, publicKey, reference, new Date().toISOString());
    const stored = this.loadOwner(ownerId);
    if (stored === undefined) throw new Error("owner_key_not_found");
    return stored;
  }
}
