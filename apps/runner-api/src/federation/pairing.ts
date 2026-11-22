import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

export interface PairedNode {
  readonly id: string;
  readonly ownerId: string;
  readonly publicKey: string;
  readonly certificateFingerprint: string;
  readonly securityPosture: "unknown";
  readonly capabilities: readonly string[];
  readonly resources: readonly never[];
  readonly inboundListener: false;
}

interface PairingCode {
  readonly digest: string;
  readonly ownerId: string;
  readonly expiresAt: number;
  usedAt?: number;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class FederationPairingService {
  readonly #codes = new Map<string, PairingCode>();
  readonly #nodes = new Map<string, PairedNode>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  createCode(ownerId: string, ttlMs = 300_000): { code: string; expiresAt: string } {
    const code = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + ttlMs;
    this.#codes.set(digest(code), { digest: digest(code), ownerId, expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  ownerForCode(code: string): string {
    const pairing = this.#codes.get(digest(code));
    if (pairing === undefined || pairing.usedAt !== undefined || pairing.expiresAt <= this.#now())
      throw new Error("pairing_code_invalid");
    return pairing.ownerId;
  }

  complete(nodeId: string, code: string): PairedNode & { readonly nodePrivateKey: string } {
    const key = digest(code);
    const pairing = this.#codes.get(key);
    if (pairing === undefined || pairing.usedAt !== undefined || pairing.expiresAt <= this.#now()) {
      throw new Error("pairing_code_invalid");
    }
    if (this.#nodes.has(nodeId)) throw new Error("node_already_paired");
    pairing.usedAt = this.#now();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const node: PairedNode = {
      id: nodeId,
      ownerId: pairing.ownerId,
      publicKey: pem,
      certificateFingerprint: digest(pem),
      securityPosture: "unknown",
      capabilities: ["snapshot.read"],
      resources: [],
      inboundListener: false,
    };
    this.#nodes.set(nodeId, node);
    this.#codes.delete(key);
    return { ...node, nodePrivateKey: privatePem };
  }

  rotate(nodeId: string): PairedNode & { readonly nodePrivateKey: string } {
    const current = this.#nodes.get(nodeId);
    if (current === undefined) throw new Error("node_not_found");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const rotated = { ...current, publicKey: pem, certificateFingerprint: digest(pem) };
    this.#nodes.set(nodeId, rotated);
    return { ...rotated, nodePrivateKey: privatePem };
  }

  get(nodeId: string): PairedNode {
    const node = this.#nodes.get(nodeId);
    if (node === undefined) throw new Error("node_not_found");
    return node;
  }

  list(): PairedNode[] {
    return [...this.#nodes.values()];
  }
}
