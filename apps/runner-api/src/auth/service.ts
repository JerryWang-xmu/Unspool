import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hashRawSync as argon2HashRawSync } from "@node-rs/argon2";
import { hash as argon2Hash, verify as argon2Verify, type HashOptions } from "argon2";

export type UserStatus = "active" | "disabled";

export interface AuthUser {
  readonly id: string;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly authVersion: number;
  readonly createdAt: string;
  readonly disabledAt?: string;
}

export interface AuthSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly authVersion: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export interface PublicSession {
  readonly id: string;
  readonly userId: string;
  readonly authVersion: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export interface AuthInvitation {
  readonly id: string;
  readonly codeHash: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly usedAt?: string;
  readonly usedBy?: string;
}

export interface PublicInvitation {
  readonly id: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly usedAt?: string;
  readonly usedBy?: string;
}

export interface AuthStore {
  readonly countUsers: () => Promise<number>;
  readonly findUserById: (userId: string) => Promise<AuthUser | null>;
  readonly findUserByDisplayName: (displayName: string) => Promise<AuthUser | null>;
  readonly insertUser: (user: AuthUser, passwordHash: string) => Promise<void>;
  readonly updateUser: (user: AuthUser) => Promise<void>;
  readonly passwordHashFor: (userId: string) => Promise<string | null>;
  readonly insertSession: (session: AuthSession) => Promise<void>;
  readonly findSessionByTokenHash: (tokenHash: string) => Promise<AuthSession | null>;
  readonly updateSession: (session: AuthSession) => Promise<void>;
  readonly revokeSessionsForUser: (userId: string, revokedAt: string) => Promise<void>;
  readonly insertInvitation: (invitation: AuthInvitation) => Promise<void>;
  readonly findInvitationByCodeHash: (codeHash: string) => Promise<AuthInvitation | null>;
  readonly updateInvitation: (invitation: AuthInvitation) => Promise<void>;
}

export interface AuthSessionResult {
  readonly user: AuthUser;
  readonly session: PublicSession;
  readonly token: string;
}

export interface AuthenticatedPrincipal {
  readonly user: AuthUser;
  readonly session: PublicSession;
}

export interface PasswordHasher {
  readonly hash: (password: string) => Promise<string>;
  readonly verify: (password: string, encoded: string) => Promise<boolean>;
}

export interface AuthServiceOptions {
  readonly store?: AuthStore;
  readonly passwordHasher?: PasswordHasher;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly sessionTtlMs?: number;
  readonly invitationTtlMs?: number;
}

export interface BootstrapInput {
  readonly displayName: string;
  readonly password: string;
}

export interface LoginInput {
  readonly displayName: string;
  readonly password: string;
}

export interface CreateInvitationInput {
  readonly createdBy: string;
  readonly expiresAt?: string;
}

export interface AcceptInvitationInput {
  readonly code: string;
  readonly displayName: string;
  readonly password: string;
}

export type AuthErrorCode =
  | "bootstrap_unavailable"
  | "display_name_taken"
  | "invalid_request"
  | "invitation_invalid"
  | "inviter_unavailable"
  | "user_not_found";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeDisplayName = (displayName: string): string => {
  const normalized = displayName.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new AuthError(
      "invalid_request",
      "Display name must contain between 1 and 100 characters.",
    );
  }
  return normalized;
};

const displayNameKey = (displayName: string): string => displayName.trim().toLowerCase();

const assertPassword = (password: string): void => {
  if (password.length === 0 || password.length > 1024) {
    throw new AuthError("invalid_request", "Password must contain between 1 and 1024 characters.");
  }
};

const sha256Hex = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const toPublicSession = (session: AuthSession): PublicSession => ({
  id: session.id,
  userId: session.userId,
  authVersion: session.authVersion,
  createdAt: session.createdAt,
  expiresAt: session.expiresAt,
  ...(session.revokedAt === undefined ? {} : { revokedAt: session.revokedAt }),
});

const toPublicInvitation = (invitation: AuthInvitation): PublicInvitation => ({
  id: invitation.id,
  createdBy: invitation.createdBy,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
  ...(invitation.usedAt === undefined ? {} : { usedAt: invitation.usedAt }),
  ...(invitation.usedBy === undefined ? {} : { usedBy: invitation.usedBy }),
});

const createUuidV7 = (): string => {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

export class InMemoryAuthStore implements AuthStore {
  readonly #users = new Map<string, AuthUser>();
  readonly #usersByName = new Map<string, string>();
  readonly #passwordHashes = new Map<string, string>();
  readonly #sessions = new Map<string, AuthSession>();
  readonly #sessionHashes = new Map<string, string>();
  readonly #invitations = new Map<string, AuthInvitation>();
  readonly #invitationHashes = new Map<string, string>();

  async countUsers(): Promise<number> {
    return this.#users.size;
  }

  async findUserById(userId: string): Promise<AuthUser | null> {
    const user = this.#users.get(userId);
    return user === undefined ? null : { ...user };
  }

  async findUserByDisplayName(displayName: string): Promise<AuthUser | null> {
    const userId = this.#usersByName.get(displayNameKey(displayName));
    if (userId === undefined) {
      return null;
    }
    return this.findUserById(userId);
  }

  async insertUser(user: AuthUser, passwordHash: string): Promise<void> {
    const key = displayNameKey(user.displayName);
    if (this.#users.has(user.id) || this.#usersByName.has(key)) {
      throw new Error("Auth user already exists");
    }
    this.#users.set(user.id, { ...user });
    this.#usersByName.set(key, user.id);
    this.#passwordHashes.set(user.id, passwordHash);
  }

  async updateUser(user: AuthUser): Promise<void> {
    const existing = this.#users.get(user.id);
    if (existing === undefined) {
      throw new Error("Auth user does not exist");
    }
    const previousKey = displayNameKey(existing.displayName);
    const nextKey = displayNameKey(user.displayName);
    if (previousKey !== nextKey && this.#usersByName.has(nextKey)) {
      throw new Error("Auth display name already exists");
    }
    this.#users.set(user.id, { ...user });
    if (previousKey !== nextKey) {
      this.#usersByName.delete(previousKey);
      this.#usersByName.set(nextKey, user.id);
    }
  }

  async passwordHashFor(userId: string): Promise<string | null> {
    return this.#passwordHashes.get(userId) ?? null;
  }

  async insertSession(session: AuthSession): Promise<void> {
    this.#sessions.set(session.id, { ...session });
    this.#sessionHashes.set(session.tokenHash, session.id);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const sessionId = this.#sessionHashes.get(tokenHash);
    if (sessionId === undefined) {
      return null;
    }
    const session = this.#sessions.get(sessionId);
    return session === undefined ? null : { ...session };
  }

  async updateSession(session: AuthSession): Promise<void> {
    if (!this.#sessions.has(session.id)) {
      throw new Error("Auth session does not exist");
    }
    this.#sessions.set(session.id, { ...session });
  }

  async revokeSessionsForUser(userId: string, revokedAt: string): Promise<void> {
    for (const [sessionId, session] of this.#sessions) {
      if (session.userId === userId && session.revokedAt === undefined) {
        this.#sessions.set(sessionId, { ...session, revokedAt });
      }
    }
  }

  async insertInvitation(invitation: AuthInvitation): Promise<void> {
    if (this.#invitations.has(invitation.id)) {
      throw new Error("Auth invitation already exists");
    }
    this.#invitations.set(invitation.id, { ...invitation });
    this.#invitationHashes.set(invitation.codeHash, invitation.id);
  }

  async findInvitationByCodeHash(codeHash: string): Promise<AuthInvitation | null> {
    const invitationId = this.#invitationHashes.get(codeHash);
    if (invitationId === undefined) {
      return null;
    }
    const invitation = this.#invitations.get(invitationId);
    return invitation === undefined ? null : { ...invitation };
  }

  async updateInvitation(invitation: AuthInvitation): Promise<void> {
    if (!this.#invitations.has(invitation.id)) {
      throw new Error("Auth invitation does not exist");
    }
    this.#invitations.set(invitation.id, { ...invitation });
  }
}

export class AuthService {
  readonly #store: AuthStore;
  readonly #passwordHasher: PasswordHasher;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #sessionTtlMs: number;
  readonly #invitationTtlMs: number;

  constructor(options: AuthServiceOptions = {}) {
    const sessionTtlMs = options.sessionTtlMs ?? 30 * DAY_MS;
    const invitationTtlMs = options.invitationTtlMs ?? 7 * DAY_MS;
    if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) {
      throw new RangeError("sessionTtlMs must be a positive number");
    }
    if (!Number.isFinite(invitationTtlMs) || invitationTtlMs <= 0) {
      throw new RangeError("invitationTtlMs must be a positive number");
    }

    this.#store = options.store ?? new InMemoryAuthStore();
    this.#passwordHasher = options.passwordHasher ?? argon2idPasswordHasher;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? createUuidV7;
    this.#sessionTtlMs = sessionTtlMs;
    this.#invitationTtlMs = invitationTtlMs;
  }

  async bootstrap(input: BootstrapInput): Promise<AuthSessionResult> {
    if ((await this.#store.countUsers()) > 0) {
      throw new AuthError("bootstrap_unavailable", "Bootstrap has already been completed.");
    }
    return this.#createUser(input.displayName, input.password);
  }

  async login(input: LoginInput): Promise<AuthSessionResult | null> {
    const user = await this.#store.findUserByDisplayName(input.displayName);
    if (user === null) {
      return null;
    }

    const passwordHash = await this.#store.passwordHashFor(user.id);
    if (passwordHash === null) {
      return null;
    }
    if (!(await this.#passwordHasher.verify(input.password, passwordHash))) {
      return null;
    }
    if (user.status !== "active") {
      return null;
    }

    return this.#createSessionResult(user);
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0) {
      return null;
    }

    const session = await this.#store.findSessionByTokenHash(sha256Hex(normalizedToken));
    if (session === null) {
      return null;
    }

    const nowMs = this.#now().getTime();
    const expiresAt = Date.parse(session.expiresAt);
    if (session.revokedAt !== undefined || !Number.isFinite(expiresAt) || expiresAt <= nowMs) {
      return null;
    }

    const user = await this.#store.findUserById(session.userId);
    if (user === null || user.status !== "active" || session.authVersion !== user.authVersion) {
      if (session.revokedAt === undefined) {
        await this.#store.updateSession({
          ...session,
          revokedAt: new Date(nowMs).toISOString(),
        });
      }
      return null;
    }

    return { user, session: toPublicSession(session) };
  }

  async revokeSession(token: string): Promise<boolean> {
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0) {
      return false;
    }

    const session = await this.#store.findSessionByTokenHash(sha256Hex(normalizedToken));
    if (session === null) {
      return false;
    }
    if (session.revokedAt === undefined) {
      await this.#store.updateSession({
        ...session,
        revokedAt: this.#now().toISOString(),
      });
    }
    return true;
  }

  async createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ readonly invitation: PublicInvitation; readonly code: string }> {
    const inviter = await this.#store.findUserById(input.createdBy);
    if (inviter === null || inviter.status !== "active") {
      throw new AuthError("inviter_unavailable", "The inviter is not available.");
    }

    const now = this.#now();
    const expiresAt =
      input.expiresAt === undefined
        ? new Date(now.getTime() + this.#invitationTtlMs).toISOString()
        : input.expiresAt;
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      throw new AuthError(
        "invalid_request",
        "Invitation expiry must be a future RFC 3339 timestamp.",
      );
    }

    const code = randomBytes(32).toString("base64url");
    const invitation: AuthInvitation = {
      id: this.#newId(),
      codeHash: sha256Hex(code),
      createdBy: inviter.id,
      createdAt: now.toISOString(),
      expiresAt,
    };
    await this.#store.insertInvitation(invitation);

    return { invitation: toPublicInvitation(invitation), code };
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<AuthSessionResult> {
    const codeHash = sha256Hex(input.code.trim());
    const invitation = await this.#store.findInvitationByCodeHash(codeHash);
    const nowMs = this.#now().getTime();
    if (
      invitation === null ||
      invitation.usedAt !== undefined ||
      !Number.isFinite(Date.parse(invitation.expiresAt)) ||
      Date.parse(invitation.expiresAt) <= nowMs
    ) {
      throw new AuthError(
        "invitation_invalid",
        "The invitation is invalid, expired, or already used.",
      );
    }

    const result = await this.#createUser(input.displayName, input.password);
    await this.#store.updateInvitation({
      ...invitation,
      usedAt: new Date(nowMs).toISOString(),
      usedBy: result.user.id,
    });
    return result;
  }

  async disableUser(userId: string): Promise<AuthUser> {
    const user = await this.#store.findUserById(userId);
    if (user === null) {
      throw new AuthError("user_not_found", "The user does not exist.");
    }
    if (user.status === "disabled") {
      return user;
    }

    const disabledAt = this.#now().toISOString();
    const disabledUser: AuthUser = {
      ...user,
      status: "disabled",
      authVersion: user.authVersion + 1,
      disabledAt,
    };
    await this.#store.updateUser(disabledUser);
    await this.#store.revokeSessionsForUser(user.id, disabledAt);
    return disabledUser;
  }

  async #createUser(displayName: string, password: string): Promise<AuthSessionResult> {
    const normalizedName = normalizeDisplayName(displayName);
    assertPassword(password);

    const existing = await this.#store.findUserByDisplayName(normalizedName);
    if (existing !== null) {
      throw new AuthError("display_name_taken", "The display name is already in use.");
    }

    const passwordHash = await this.#passwordHasher.hash(password);
    const user: AuthUser = {
      id: this.#newId(),
      displayName: normalizedName,
      status: "active",
      authVersion: 1,
      createdAt: this.#now().toISOString(),
    };
    await this.#store.insertUser(user, passwordHash);
    return this.#createSessionResult(user);
  }

  async #createSessionResult(user: AuthUser): Promise<AuthSessionResult> {
    const token = randomBytes(32).toString("base64url");
    const now = this.#now();
    const session: AuthSession = {
      id: this.#newId(),
      userId: user.id,
      tokenHash: sha256Hex(token),
      authVersion: user.authVersion,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#sessionTtlMs).toISOString(),
    };
    await this.#store.insertSession(session);

    return { user, session: toPublicSession(session), token };
  }
}

export function createAuthService(options: AuthServiceOptions = {}): AuthService {
  return new AuthService(options);
}

/* -------------------------------------------------------------------------- */
/* Argon2id v1.3 (RFC 9106), PHC-encoded passwords                             */
/* -------------------------------------------------------------------------- */

export interface Argon2idOptions {
  readonly memoryKiB?: number;
  readonly iterations?: number;
  readonly parallelism?: number;
  readonly saltBytes?: number;
  readonly salt?: Uint8Array;
  readonly tagLength?: number;
}

export interface Argon2idInput {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly secret?: Uint8Array;
  readonly associatedData?: Uint8Array;
  readonly memoryKiB?: number;
  readonly iterations?: number;
  readonly parallelism?: number;
  readonly tagLength?: number;
}

export const ARGON2ID_DEFAULTS = Object.freeze({
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
  saltBytes: 16,
  tagLength: 32,
});

// PHC helpers validate inputs at the authentication trust boundary.
const ARGON2_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function ensureInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

interface ParsedArgon2id {
  salt: Buffer;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hash: Buffer;
}

function parseArgon2id(encoded: string): ParsedArgon2id | null {
  const match = ARGON2_PATTERN.exec(encoded);
  if (match === null) return null;
  try {
    const encodedSalt = match[4];
    const encodedHash = match[5];
    if (encodedSalt === undefined || encodedHash === undefined) return null;
    const salt = Buffer.from(encodedSalt, "base64");
    const hash = Buffer.from(encodedHash, "base64");
    return {
      salt,
      memoryKiB: Number(match[1]),
      iterations: Number(match[2]),
      parallelism: Number(match[3]),
      hash,
    };
  } catch {
    return null;
  }
}

export async function argon2id(input: Argon2idInput): Promise<Uint8Array> {
  const salt = input.salt;
  const memoryKiB = input.memoryKiB ?? ARGON2ID_DEFAULTS.memoryKiB;
  const iterations = input.iterations ?? ARGON2ID_DEFAULTS.iterations;
  const parallelism = input.parallelism ?? ARGON2ID_DEFAULTS.parallelism;
  const tagLength = input.tagLength ?? ARGON2ID_DEFAULTS.tagLength;

  ensureInteger(memoryKiB, 8, 262_144, "memory");
  ensureInteger(iterations, 1, 16, "iterations");
  ensureInteger(parallelism, 1, 16, "parallelism");
  ensureInteger(tagLength, 4, 64, "tag length");
  if (salt.length < 8 || salt.length > 64) {
    throw new RangeError("Argon2id salt must be between 8 and 64 bytes");
  }

  const options: HashOptions & { raw: true } = {
    memoryCost: memoryKiB,
    timeCost: iterations,
    parallelism,
    hashLength: tagLength,
    version: 0x13,
    salt: Buffer.from(salt),
    type: 2,
    raw: true,
  };
  if (input.associatedData) options.associatedData = Buffer.from(input.associatedData);
  if (input.secret) options.secret = Buffer.from(input.secret);
  return argon2Hash(Buffer.from(input.password), options);
}

export function hashPassword(password: string, options: Argon2idOptions = {}): Promise<string> {
  return Promise.resolve(hashPasswordSync(password, options));
}

export function hashPasswordSync(password: string, options: Argon2idOptions = {}): string {
  if (password.length === 0 || password.length > 1024) {
    throw new RangeError("Password must contain between 1 and 1024 characters");
  }

  const saltBytes = options.saltBytes ?? ARGON2ID_DEFAULTS.saltBytes;
  ensureInteger(saltBytes, 8, 64, "salt length");
  const salt = options.salt ?? randomBytes(saltBytes);
  const memoryKiB = options.memoryKiB ?? ARGON2ID_DEFAULTS.memoryKiB;
  const iterations = options.iterations ?? ARGON2ID_DEFAULTS.iterations;
  const parallelism = options.parallelism ?? ARGON2ID_DEFAULTS.parallelism;
  const tagLength = options.tagLength ?? ARGON2ID_DEFAULTS.tagLength;

  const tag = argon2HashRawSync(Buffer.from(password, "utf8"), {
    memoryCost: memoryKiB,
    timeCost: iterations,
    parallelism,
    outputLen: tagLength,
    algorithm: 2,
    version: 1,
    salt,
  });

  return `$argon2id$v=19$m=${memoryKiB},t=${iterations},p=${parallelism}$${encodeBase64(salt)}$${encodeBase64(tag)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (encoded.length === 0 || password.length === 0 || password.length > 1024) {
    return false;
  }
  const parsed = parseArgon2id(encoded);
  if (parsed === null) return false;
  try {
    const normalized = `$argon2id$v=19$m=${parsed.memoryKiB},t=${parsed.iterations},p=${parsed.parallelism}$${encodeBase64(parsed.salt).replace(/=+$/, "")}$${encodeBase64(parsed.hash).replace(/=+$/, "")}`;
    return await argon2Verify(normalized, password);
  } catch {
    return false;
  }
}

export function verifyPasswordSync(password: string, encoded: string): boolean {
  const parsed = parseArgon2id(encoded);
  if (parsed === null || password.length === 0 || password.length > 1024) {
    return false;
  }

  try {
    const expected = argon2HashRawSync(Buffer.from(password, "utf8"), {
      memoryCost: parsed.memoryKiB,
      timeCost: parsed.iterations,
      parallelism: parsed.parallelism,
      outputLen: parsed.hash.length,
      algorithm: 2,
      version: 1,
      salt: parsed.salt,
    });

    return (
      expected.length === parsed.hash.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.hash))
    );
  } catch {
    return false;
  }
}

export const argon2idPasswordHasher: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
};

export const randomId = createUuidV7;
