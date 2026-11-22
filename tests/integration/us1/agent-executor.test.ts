import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { derivedLocalId } from "../../../apps/runner-api/src/auth/bearer";
import { buildServer } from "../../../apps/runner-api/src/index";
import { resolveAgentModelConfig } from "../../../packages/pi-adapter/src/openai-runtime";

const OWNER_TOKEN = "integration-agent-owner-not-a-secret";
const DIGEST = `sha256:${"1".repeat(64)}`;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function chunk(content: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ id: "chatcmpl-local", object: "chat.completion.chunk", created: 1, model: "kimi-k3", choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] })}\n\n`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an API object");
  }
  return value as Record<string, unknown>;
}

describe("Runner IPC Agent execution", () => {
  it("persists real Pi text and technical completion through the Runner API", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-agent-executor-"));
    const secretPath = join(dataDir, "provider.key");
    await writeFile(secretPath, "local-test-not-a-real-credential-123456");
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ object: "list", data: [{ id: "kimi-k3", object: "model" }] }),
        );
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(chunk("Runner"));
        response.write(chunk(" connected"));
        response.write(chunk("", "stop"));
        response.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("No server address");
    const config = resolveAgentModelConfig({
      UNSPOOL_MODEL_PROVIDER: "opencode-go",
      UNSPOOL_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      UNSPOOL_MODEL_ID: "kimi-k3",
      UNSPOOL_MODEL_API_KEY_REF: `file:${secretPath}`,
    });
    const app = await buildServer({
      dataDir,
      ownerToken: OWNER_TOKEN,
      modelConfig: config,
      agentWorkerEntry: resolve("apps/runner-api/dist/apps/execution-worker/src/agent-process.js"),
    });
    cleanups.push(() => app.close());
    const headers = () => ({
      authorization: `Bearer ${OWNER_TOKEN}`,
      "idempotency-key": crypto.randomUUID(),
      "content-type": "application/json",
    });
    const runnerId = derivedLocalId("runner", OWNER_TOKEN);
    const agentProfileId = derivedLocalId("model-profile", OWNER_TOKEN);
    const created = await app.inject({
      method: "POST",
      url: "/v1/personal-tasks",
      headers: headers(),
      payload: {
        name: "Real Agent integration",
        goal: "Produce a real Pi response",
        completionCriteria: "Persist the response and finish",
        runnerId,
        agentProfileId,
        payloadDigest: DIGEST,
      },
    });
    expect(created.statusCode).toBe(201);
    const workspace = asRecord(asRecord(await created.json()).workspace);
    const started = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace.id}/runs`,
      headers: headers(),
      payload: { operatorEpoch: 1, body: "Reply Runner connected", payloadDigest: DIGEST },
    });
    expect(started.statusCode).toBe(202);
    const run = asRecord(await started.json());
    let detail: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/workspaces/${workspace.id}/runs/${run.id}`,
        headers: headers(),
      });
      detail = asRecord(await response.json());
      if (["technical_complete", "failed", "needs_confirmation"].includes(String(detail.state)))
        break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    expect(detail.state).toBe("technical_complete");
    expect(JSON.stringify(detail.events)).toContain("Runner connected");
    const profiles = await app.inject({
      method: "GET",
      url: `/v1/runners/${runnerId}/model-profiles`,
      headers: headers(),
    });
    expect(JSON.stringify(await profiles.json())).toContain("opencode-go");
  }, 30_000);
});
