import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  modelForConversation,
  OPENCODE_GO_BASE_URL,
  resolveAgentModelConfig,
  writePiModelConfiguration,
} from "../../../packages/pi-adapter/src/openai-runtime";

describe("OpenAI-compatible runtime configuration", () => {
  it("resolves OpenCode Go and writes no credential material", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unspool-openai-config-"));
    const secretPath = join(directory, "go.key");
    const validationOnlyKey = "local-test-not-a-real-credential-123456";
    await writeFile(secretPath, validationOnlyKey);
    const config = resolveAgentModelConfig({
      UNSPOOL_MODEL_PROVIDER: "opencode-go",
      UNSPOOL_MODEL_ID: "kimi-k3",
      UNSPOOL_MODEL_API_KEY_REF: `file:${secretPath}`,
    });
    expect(config.baseUrl).toBe(OPENCODE_GO_BASE_URL);
    expect(config.provider).toBe("opencode-go");
    await writePiModelConfiguration(config, directory);
    const serialized = await readFile(join(directory, "models.json"), "utf8");
    expect(serialized).not.toContain(validationOnlyKey);
    expect(serialized).not.toContain(secretPath);
    expect(serialized).toContain("openai-completions");
    expect(serialized).toContain("$UNSPOOL_MODEL_API_KEY");

    const first = modelForConversation(
      {
        id: "kimi-k3",
        provider: "opencode-go",
        api: "openai-completions",
        baseUrl: OPENCODE_GO_BASE_URL,
        headers: { Existing: "kept" },
      },
      "conversation-a",
    );
    const second = modelForConversation(
      {
        id: "kimi-k3",
        provider: "opencode-go",
        api: "openai-completions",
        baseUrl: OPENCODE_GO_BASE_URL,
      },
      "conversation-b",
    );
    expect(first.headers).toMatchObject({
      Existing: "kept",
      "User-Agent": "unspool/0.1.0",
      "x-opencode-session": "conversation-a",
    });
    expect(second.headers?.["x-opencode-session"]).toBe("conversation-b");
  });

  it("supports generic OpenAI-compatible endpoints and Responses API", () => {
    const config = resolveAgentModelConfig({
      UNSPOOL_MODEL_PROVIDER: "openai-compatible",
      UNSPOOL_MODEL_BASE_URL: "http://127.0.0.1:9000/v1/",
      UNSPOOL_MODEL_ID: "local/test-model",
      UNSPOOL_MODEL_API: "openai-responses",
      UNSPOOL_MODEL_API_KEY_REF: "file:C:\\keys\\local.key",
    });
    expect(config).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:9000/v1",
      modelId: "local/test-model",
      api: "openai-responses",
    });
  });

  it("fails closed for missing credentials, invalid endpoints and unsupported providers", () => {
    expect(() =>
      resolveAgentModelConfig({
        UNSPOOL_MODEL_PROVIDER: "openai-compatible",
        UNSPOOL_MODEL_BASE_URL: "http://127.0.0.1:9000/v1",
        UNSPOOL_MODEL_ID: "local-model",
      }),
    ).toThrow(/API_KEY_REF/);
    expect(() =>
      resolveAgentModelConfig({
        UNSPOOL_MODEL_PROVIDER: "openai-compatible",
        UNSPOOL_MODEL_BASE_URL: "https://user:pass@example.com/v1",
        UNSPOOL_MODEL_ID: "model",
        UNSPOOL_MODEL_API_KEY_REF: "file:C:\\keys\\local.key",
      }),
    ).toThrow(/base URL|BASE_URL/);
    expect(() => resolveAgentModelConfig({ UNSPOOL_MODEL_PROVIDER: "openai" })).toThrow(
      /provider|PROVIDER/,
    );
  });
});
