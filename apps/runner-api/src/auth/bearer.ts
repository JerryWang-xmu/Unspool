import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sendProblem } from "../errors/problem.js";

const ACTOR_ID = Symbol("unspool.actorId");
const IDENTITY = Symbol("unspool.identity");

export interface BearerIdentity {
  readonly id: string;
  readonly displayName: string;
}

export interface BearerAuthOptions {
  readonly token: string;
  readonly ownerId?: string;
  readonly displayName?: string;
  /** Validation/development principals. Production deployments use the session store. */
  readonly additionalTokens?: Readonly<Record<string, BearerIdentity>>;
}

export interface BearerAuthenticator {
  readonly identity: BearerIdentity;
  authenticate(request: FastifyRequest): BearerIdentity | null;
  identityFor(request: FastifyRequest): BearerIdentity | null;
  actorId(request: FastifyRequest): string | null;
}

function derivedUuid(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function createBearerAuthenticator(options: BearerAuthOptions): BearerAuthenticator {
  if (options.token.trim().length === 0) throw new TypeError("A non-empty owner token is required");
  const identity: BearerIdentity = Object.freeze({
    id: options.ownerId ?? derivedUuid(`unspool-owner:${options.token}`),
    displayName: options.displayName ?? "Personal Owner",
  });
  const credentials = new Map<string, BearerIdentity>();
  credentials.set(hashToken(options.token).toString("hex"), identity);
  for (const [token, additional] of Object.entries(options.additionalTokens ?? {})) {
    if (token.trim().length === 0 || additional.id.trim().length === 0)
      throw new TypeError("Additional bearer principals require a token and id");
    const key = hashToken(token).toString("hex");
    if (credentials.has(key))
      throw new TypeError("Bearer tokens must identify distinct principals");
    credentials.set(key, Object.freeze({ ...additional }));
  }

  return {
    identity,
    authenticate(request) {
      const authorization = request.headers.authorization;
      if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
      const token = authorization.slice("Bearer ".length);
      if (token.length === 0) return null;
      const receivedHash = hashToken(token);
      for (const [expectedHex, principal] of credentials) {
        if (timingSafeEqual(receivedHash, Buffer.from(expectedHex, "hex"))) return principal;
      }
      return null;
    },
    identityFor(request) {
      const principal = (request as FastifyRequest & { [IDENTITY]?: BearerIdentity })[IDENTITY];
      return principal ?? null;
    },
    actorId(request) {
      const actorId = (request as FastifyRequest & { [ACTOR_ID]?: string })[ACTOR_ID];
      return typeof actorId === "string" ? actorId : null;
    },
  };
}

export function registerBearerAuthentication(
  app: FastifyInstance,
  authenticator: BearerAuthenticator,
): void {
  app.addHook("onRequest", async (request, reply) => {
    if (
      request.method === "OPTIONS" ||
      !request.url.startsWith("/v1/") ||
      request.url === "/v1/health" ||
      request.url === "/v1/validation/clock"
    )
      return;
    const identity = authenticator.authenticate(request);
    if (identity === null) {
      await sendProblem(reply, "unauthenticated");
      return;
    }
    Object.defineProperty(request, ACTOR_ID, { value: identity.id, enumerable: false });
    Object.defineProperty(request, IDENTITY, { value: identity, enumerable: false });
  });
}

export function derivedLocalId(kind: "runner" | "model-profile", ownerToken: string): string {
  return derivedUuid(`unspool-${kind}:${ownerToken}`);
}
