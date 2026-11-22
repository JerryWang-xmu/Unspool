import { ProblemError } from "../errors/problem.js";

export interface CommandIdempotencyOptions {
  readonly now?: () => Date;
}

export interface CommandExecutionOutcome<TResult = unknown> {
  readonly state: "succeeded" | "outcome_unknown";
  readonly result?: TResult;
}

export interface CommandExecutionInput<TResult = unknown> {
  readonly idempotencyKey: string;
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly execute: () => Promise<CommandExecutionOutcome<TResult>>;
}

export interface CommandReceipt<TResult = unknown> {
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly state: "succeeded" | "outcome_unknown";
  readonly acceptedAt: string;
  readonly result?: TResult;
}

export type CommandExecutionResult<TResult = unknown> =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly receipt: CommandReceipt<TResult>;
    }
  | {
      readonly ok: false;
      readonly code: "revision_conflict";
    };

interface InFlightAttempt {
  readonly payloadDigest: string;
  readonly promise: Promise<CommandReceipt<unknown>>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProblemError("invalid_request", { detail: `${field} is required.` });
  }
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new ProblemError("invalid_request", {
      detail: "payloadDigest must be a SHA-256 digest.",
    });
  }
  return value;
}

/**
 * Serializes commands by idempotency key. The first committed outcome is kept
 * as the authoritative receipt; later calls with the same key replay it without
 * running the command again, and a different payload digest is a conflict.
 */
export class CommandIdempotencyService {
  readonly #now: () => Date;
  readonly #receipts = new Map<string, CommandReceipt<unknown>>();
  readonly #inFlight = new Map<string, InFlightAttempt>();

  constructor(options: CommandIdempotencyOptions = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  async execute<TResult = unknown>(
    command: CommandExecutionInput<TResult>,
  ): Promise<CommandExecutionResult<TResult>> {
    const idempotencyKey = requiredText(command.idempotencyKey, "idempotencyKey");
    const commandId = requiredText(command.commandId, "commandId");
    const payloadDigest = digest(command.payloadDigest);

    const stored = this.#receipts.get(idempotencyKey);
    if (stored !== undefined) {
      if (stored.payloadDigest !== payloadDigest) {
        return { ok: false, code: "revision_conflict" };
      }
      return { ok: true, replayed: true, receipt: stored as CommandReceipt<TResult> };
    }

    const pending = this.#inFlight.get(idempotencyKey);
    if (pending !== undefined) {
      if (pending.payloadDigest !== payloadDigest) {
        return { ok: false, code: "revision_conflict" };
      }
      return {
        ok: true,
        replayed: true,
        receipt: (await pending.promise) as CommandReceipt<TResult>,
      };
    }

    let settle!: (receipt: CommandReceipt<unknown>) => void;
    let fail!: (error: unknown) => void;
    const attempt = new Promise<CommandReceipt<unknown>>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // Waiters observe this rejection; the catch prevents an unhandled rejection
    // when the original caller is the only observer of a failed attempt.
    attempt.catch(() => undefined);
    this.#inFlight.set(idempotencyKey, { payloadDigest, promise: attempt });

    try {
      const outcome = await command.execute();
      const receipt: CommandReceipt<unknown> = {
        commandId,
        payloadDigest,
        state: outcome.state,
        acceptedAt: this.#now().toISOString(),
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
      };
      this.#receipts.set(idempotencyKey, receipt);
      settle(receipt);
      return { ok: true, replayed: false, receipt: receipt as CommandReceipt<TResult> };
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      this.#inFlight.delete(idempotencyKey);
    }
  }
}

export function createCommandIdempotencyService(
  options: CommandIdempotencyOptions = {},
): CommandIdempotencyService {
  return new CommandIdempotencyService(options);
}
