import { describe, expect, it } from "vitest";
import {
  type ModelEgressGrant,
  sendToFauxModel,
} from "../../../apps/model-gateway/src/egress-policy";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const BASE: ModelEgressGrant = {
  state: "active",
  operations: ["snapshot.read"],
  notBefore: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  recipientRules: { modelIds: ["faux-model"] },
  rights: { modelDisclose: false },
};

describe("independent model.disclose authorization", () => {
  it.each(["content", "digest", "error", "log", "filename", "artifact"] as const)(
    "keeps %s bytes away from a read-only model",
    async (kind) => {
      const calls: Uint8Array[] = [];
      await expect(
        sendToFauxModel({
          grant: BASE,
          modelId: "faux-model",
          kind,
          payload: new TextEncoder().encode("secret-canary"),
          now: NOW,
          client: {
            send: (_modelId, payload) => {
              calls.push(payload);
            },
          },
        }),
      ).rejects.toThrow("model_egress_denied");
      expect(calls).toHaveLength(0);
    },
  );

  it("allows only the exact model.disclose grant and forwards the selected payload", async () => {
    const calls: { modelId: string; payload: Uint8Array }[] = [];
    const grant: ModelEgressGrant = {
      ...BASE,
      operations: ["model.disclose"],
      rights: { modelDisclose: true },
    };
    const payload = new TextEncoder().encode("approved-model-input");
    await sendToFauxModel({
      grant,
      modelId: "faux-model",
      kind: "content",
      payload,
      now: NOW,
      client: {
        send: (modelId, value) => {
          calls.push({ modelId, payload: value });
        },
      },
    });
    expect(calls).toEqual([{ modelId: "faux-model", payload }]);
    await expect(
      sendToFauxModel({
        grant,
        modelId: "other-model",
        kind: "content",
        payload,
        now: NOW,
        client: {
          send: () => {
            throw new Error("unexpected recipient");
          },
        },
      }),
    ).rejects.toThrow("model_egress_denied");
    await expect(
      sendToFauxModel({
        grant: { ...grant, expiresAt: NOW.toISOString() },
        modelId: "faux-model",
        kind: "content",
        payload,
        now: NOW,
        client: {
          send: () => {
            throw new Error("expired grant used");
          },
        },
      }),
    ).rejects.toThrow("model_egress_denied");
  });
});
