export type EgressPayloadKind = "content" | "digest" | "error" | "log" | "filename" | "artifact";

export interface ModelEgressGrant {
  readonly state: "active" | "expired" | "revoked" | "rejected";
  readonly operations: readonly string[];
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly recipientRules: { readonly modelIds: readonly string[] };
  readonly rights: { readonly modelDisclose: boolean };
}

export function assertModelEgress(input: {
  readonly grant: ModelEgressGrant;
  readonly modelId: string;
  readonly kind: EgressPayloadKind;
  readonly now: Date;
}): void {
  const now = input.now.getTime();
  if (input.grant.state !== "active") throw new Error("model_egress_denied");
  if (
    !input.grant.operations.includes("model.disclose") ||
    input.grant.rights.modelDisclose !== true
  )
    throw new Error("model_egress_denied");
  if (!input.grant.recipientRules.modelIds.includes(input.modelId))
    throw new Error("model_egress_denied");
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(input.grant.notBefore)) ||
    !Number.isFinite(Date.parse(input.grant.expiresAt))
  )
    throw new Error("grant_time_invalid");
  if (Date.parse(input.grant.notBefore) > now || Date.parse(input.grant.expiresAt) <= now)
    throw new Error("model_egress_denied");
  void input.kind;
}

/** Calls the model only after independent model.disclose authorization. */
export async function sendToFauxModel(input: {
  readonly grant: ModelEgressGrant;
  readonly modelId: string;
  readonly kind: EgressPayloadKind;
  readonly payload: Uint8Array;
  readonly now: Date;
  readonly client: { send(modelId: string, payload: Uint8Array): Promise<void> | void };
}): Promise<void> {
  assertModelEgress(input);
  await input.client.send(input.modelId, input.payload);
}
