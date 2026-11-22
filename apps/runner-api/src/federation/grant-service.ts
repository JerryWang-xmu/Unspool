import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { stableJson } from "../../../../packages/contracts/src/federation-validation.js";
import type { FederationGrantStore } from "./grant-store.js";

export interface FederationGrant {
  readonly id: string;
  readonly nodeId: string;
  readonly ownerId: string;
  readonly resourceId: string;
  readonly resourceDigest: string;
  readonly operations: readonly string[];
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly usageLimit: number;
  readonly policyRevision: number;
  readonly state: "pending" | "active" | "rejected" | "revoked" | "expired";
  readonly ownerSignature?: string;
  readonly revocationTombstone?: string;
  readonly recipientRules: { readonly recipientIds: readonly string[] };
}

interface PendingGrant extends FederationGrant {}

function canonical(grant: FederationGrant): string {
  const { ownerSignature: _signature, revocationTombstone: _tombstone, ...signed } = grant;
  return stableJson(signed);
}

export class FederationGrantService {
  readonly #grants = new Map<string, FederationGrant>();
  readonly #ownerKeys = new Map<string, { publicKey: string; privateKey: string }>();
  readonly #decisionReceipts = new Map<string, FederationGrant>();
  readonly #now: () => Date;
  readonly #store: FederationGrantStore | undefined;

  constructor(now: () => Date = () => new Date(), store?: FederationGrantStore) {
    this.#now = now;
    this.#store = store;
    if (store !== undefined) {
      for (const grant of store.loadGrants()) this.#grants.set(grant.id, grant);
      for (const ownerId of store.listOwnerIds()) {
        const record = store.loadOwner(ownerId);
        if (record !== undefined) this.#ownerKeys.set(ownerId, record);
      }
    }
  }

  registerOwner(ownerId: string): { publicKey: string } {
    const existing = this.#ownerKeys.get(ownerId);
    if (existing !== undefined) return { publicKey: existing.publicKey };
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const stored = this.#store?.saveOwner(ownerId, { publicKey, privateKey }) ?? {
      publicKey,
      privateKey,
    };
    this.#ownerKeys.set(ownerId, stored);
    return { publicKey: stored.publicKey };
  }

  propose(
    input: Omit<FederationGrant, "state" | "ownerSignature" | "revocationTombstone">,
  ): FederationGrant {
    if (this.#grants.has(input.id)) throw new Error("grant_already_exists");
    if (
      input.operations.length === 0 ||
      !Number.isSafeInteger(input.usageLimit) ||
      input.usageLimit < 1
    )
      throw new Error("grant_budget_invalid");
    if (
      !Number.isFinite(Date.parse(input.notBefore)) ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(input.notBefore)
    )
      throw new Error("grant_time_invalid");
    const grant: PendingGrant = {
      ...input,
      recipientRules: input.recipientRules ?? { recipientIds: [] },
      state: "pending",
    };
    this.#grants.set(grant.id, grant);
    this.#store?.saveGrant(grant);
    return grant;
  }

  decide(
    grantId: string,
    decision: "active" | "rejected" | "revoked",
    reduction?: Partial<Pick<FederationGrant, "operations" | "usageLimit" | "expiresAt">>,
  ): FederationGrant {
    const grant = this.#grants.get(grantId);
    if (grant === undefined) throw new Error("grant_not_found");
    if (grant.state !== "pending") {
      if (decision === "revoked" && grant.state === "active") {
        // Active grants may always be revoked by their owner.
      } else if (decision === "active" && grant.state === "active" && reduction !== undefined) {
        // A reduction creates a narrower policy revision without reviving a grant.
      } else {
        if (reduction !== undefined) this.#reduce(grant, reduction);
        if (grant.state === decision && reduction === undefined) {
          const receipt = this.#decisionReceipts.get(`${grantId}:${decision}`);
          if (receipt !== undefined) return receipt;
        }
        throw new Error("grant_terminal");
      }
    }
    if (decision === "revoked" && !["active", "pending"].includes(grant.state))
      throw new Error("grant_terminal");
    const narrowed = reduction === undefined ? grant : this.#reduce(grant, reduction);
    const now = this.#now().toISOString();
    const signature = this.#sign(narrowed.ownerId, canonical({ ...narrowed, state: decision }));
    const decided: FederationGrant = {
      ...narrowed,
      state: decision,
      ownerSignature: signature,
      ...(decision === "revoked" ? { revocationTombstone: now } : {}),
    };
    this.#store?.saveGrant(decided, grant.state);
    this.#grants.set(grantId, decided);
    this.#decisionReceipts.set(`${grantId}:${decision}`, decided);
    return decided;
  }

  get(grantId: string): FederationGrant {
    const grant = this.#grants.get(grantId);
    if (grant === undefined) throw new Error("grant_not_found");
    if (grant.state === "active" && Date.parse(grant.expiresAt) <= this.#now().getTime()) {
      const expired = { ...grant, state: "expired" as const };
      this.#store?.saveGrant(expired, grant.state);
      this.#grants.set(grantId, expired);
      return expired;
    }
    return grant;
  }

  verify(grantId: string): boolean {
    const grant = this.get(grantId);
    if (grant.state !== "active" || grant.ownerSignature === undefined) return false;
    const now = this.#now().getTime();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(Date.parse(grant.notBefore)) ||
      !Number.isFinite(Date.parse(grant.expiresAt))
    )
      return false;
    if (Date.parse(grant.notBefore) > now || Date.parse(grant.expiresAt) <= now) return false;
    return this.#verify(grant.ownerId, canonical(grant), grant.ownerSignature);
  }

  #reduce(
    grant: FederationGrant,
    reduction: Required<Parameters<FederationGrantService["decide"]>>[2],
  ): FederationGrant {
    if (
      reduction.operations !== undefined &&
      !reduction.operations.every((operation) => grant.operations.includes(operation))
    ) {
      throw new Error("grant_expansion_denied");
    }
    if (reduction.usageLimit !== undefined && reduction.usageLimit > grant.usageLimit)
      throw new Error("grant_expansion_denied");
    if (
      reduction.expiresAt !== undefined &&
      Date.parse(reduction.expiresAt) > Date.parse(grant.expiresAt)
    )
      throw new Error("grant_expansion_denied");
    return { ...grant, ...reduction, policyRevision: grant.policyRevision + 1 };
  }

  #sign(ownerId: string, payload: string): string {
    const keys = this.#ownerKeys.get(ownerId);
    if (keys === undefined) throw new Error("owner_key_not_found");
    return sign(null, Buffer.from(payload), keys.privateKey).toString("base64");
  }

  #verify(ownerId: string, payload: string, signature: string): boolean {
    const keys = this.#ownerKeys.get(ownerId);
    if (keys === undefined) return false;
    return verify(null, Buffer.from(payload), keys.publicKey, Buffer.from(signature, "base64"));
  }
}

export function grantDigest(grant: FederationGrant): string {
  return `sha256:${createHash("sha256").update(canonical(grant)).digest("hex")}`;
}
