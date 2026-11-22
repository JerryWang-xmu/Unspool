import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const PRAGMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i;
const FILE_WRITE_TAILS = new Map<string, Promise<void>>();

function fileWriteKey(filename: string): string | undefined {
  if (filename === ":memory:") return undefined;
  const normalized = resolve(filename);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function withFileWriteLock<T>(filename: string, work: () => T | Promise<T>): Promise<T> {
  const key = fileWriteKey(filename);
  if (key === undefined) return work();
  const previous = FILE_WRITE_TAILS.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  const queued = previous.then(() => current);
  FILE_WRITE_TAILS.set(key, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (FILE_WRITE_TAILS.get(key) === queued) FILE_WRITE_TAILS.delete(key);
  }
}

export type SqliteRow = Record<string, SQLInputValue>;

export interface SqliteTransaction {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  executeScript(sql: string): Promise<void>;
  query<T = SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface SqliteDatabase extends SqliteTransaction {
  readonly filename: string;
  pragma<T = unknown>(name: string): Promise<T>;
  write<T>(work: (transaction: SqliteTransaction) => T | Promise<T>): Promise<T>;
  transaction<T>(work: (transaction: SqliteTransaction) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenDatabaseOptions {
  filename: string;
  busyTimeoutMs?: number | undefined;
}

function toSqlInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint" || value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`);
}

function bindParameters(params: readonly unknown[]): SQLInputValue[] {
  return params.map(toSqlInput);
}

function assertPragmaName(name: string): void {
  if (!PRAGMA_NAME_PATTERN.test(name)) {
    throw new TypeError(`Invalid SQLite pragma name: ${name}`);
  }
}

class SqliteDatabaseConnection implements SqliteDatabase {
  readonly filename: string;
  readonly #database: DatabaseSync;
  readonly #activeWrite = new AsyncLocalStorage<true>();
  readonly #transaction: SqliteTransaction;
  #tail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(database: DatabaseSync, filename: string) {
    this.#database = database;
    this.filename = filename;
    this.#transaction = {
      execute: async (sql, params = []) => {
        this.#executeNow(sql, params);
      },
      executeScript: async (sql) => {
        this.#database.exec(sql);
      },
      query: async <T = SqliteRow>(sql: string, params: readonly unknown[] = []) =>
        this.#queryNow<T>(sql, params),
    };
  }

  async pragma<T = unknown>(name: string): Promise<T> {
    assertPragmaName(name);
    return this.#enqueue(() => {
      const row = this.#database.prepare(`PRAGMA ${name}`).get();
      if (row === undefined) return undefined as T;
      return Object.values(row)[0] as T;
    });
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    await this.#enqueue(() => {
      this.#executeNow(sql, params);
    });
  }

  async executeScript(sql: string): Promise<void> {
    await this.#enqueue(() => {
      this.#database.exec(sql);
    });
  }

  async query<T = SqliteRow>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.#enqueue(() => this.#queryNow<T>(sql, params));
  }

  write<T>(work: (transaction: SqliteTransaction) => T | Promise<T>): Promise<T> {
    if (this.#activeWrite.getStore()) {
      return Promise.resolve().then(() => work(this.#transaction));
    }

    return this.#enqueue(() =>
      withFileWriteLock(this.filename, async () => {
        this.#database.exec("BEGIN IMMEDIATE");
        try {
          const result = await this.#activeWrite.run(true, () => work(this.#transaction));
          this.#database.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            this.#database.exec("ROLLBACK");
          } catch {
            // The transaction may already have been rolled back by SQLite.
          }
          throw error;
        }
      }),
    );
  }

  transaction<T>(work: (transaction: SqliteTransaction) => T | Promise<T>): Promise<T> {
    return this.write(work);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#tail;
    this.#database.close();
  }

  #executeNow(sql: string, params: readonly unknown[]): void {
    this.#database.prepare(sql).run(...bindParameters(params));
  }

  #queryNow<T>(sql: string, params: readonly unknown[]): T[] {
    const statement = this.#database.prepare(sql);
    const rows = statement.all(...bindParameters(params));
    return rows as T[];
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.#activeWrite.getStore()) {
      return Promise.resolve().then(operation);
    }

    const result = this.#tail.then(operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function openDatabase(options: OpenDatabaseOptions): Promise<SqliteDatabase> {
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be a non-negative integer: ${busyTimeoutMs}`);
  }

  if (options.filename !== ":memory:") {
    await mkdir(dirname(options.filename), { recursive: true });
  }

  const connection = new DatabaseSync(options.filename);
  try {
    connection.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    connection.exec("PRAGMA journal_mode = WAL");
    connection.exec("PRAGMA foreign_keys = ON");
  } catch (error) {
    connection.close();
    throw error;
  }

  return new SqliteDatabaseConnection(connection, options.filename);
}
