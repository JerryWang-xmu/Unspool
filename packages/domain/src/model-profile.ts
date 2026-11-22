import type { JsonObject } from "./validation.js";
import { boolean, object, text } from "./validation.js";

export interface ModelProfile {
  id: string;
  runnerId: string;
  provider: string;
  model: string;
  reasoningOptions: JsonObject;
  secretRef: string;
  enabled: boolean;
}

export function parseModelProfile(value: unknown): ModelProfile {
  const input = object(value, "ModelProfile");
  return {
    id: text(input.id, "ModelProfile.id"),
    runnerId: text(input.runnerId, "ModelProfile.runnerId"),
    provider: text(input.provider, "ModelProfile.provider"),
    model: text(input.model, "ModelProfile.model"),
    reasoningOptions: object(input.reasoningOptions, "ModelProfile.reasoningOptions"),
    secretRef: text(input.secretRef, "ModelProfile.secretRef"),
    enabled: boolean(input.enabled, "ModelProfile.enabled"),
  };
}
