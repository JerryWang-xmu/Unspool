import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentWorkerEvent,
  createAgentSessionWorker,
} from "../../../apps/execution-worker/src/agent-session";
import { resolveAgentModelConfig } from "../../../packages/pi-adapter/src/openai-runtime";

interface CapturedRequest {
  readonly authorization?: string | undefined;
  readonly session?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly body: { readonly model?: string; readonly messages?: readonly unknown[] };
}

function chunk(content: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ id: "chatcmpl-local", object: "chat.completion.chunk", created: 1, model: "kimi-k3", choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] })}\n\n`;
}

describe("real Pi AgentSession over OpenAI-compatible transport", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it("runs a real session and forwards OpenCode Go identity, session and output", async () => {
    const root = await mkdtemp(join(tmpdir(), "unspool-real-pi-"));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });
    const secretPath = join(root, "go.key");
    const validationOnlyKey = "local-test-not-a-real-credential-123456";
    await writeFile(secretPath, validationOnlyKey);
    const requests: CapturedRequest[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            object: "list",
            data: [{ id: "kimi-k3", object: "model", owned_by: "local" }],
          }),
        );
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on("data", (value: Buffer) => chunks.push(value));
      request.on("end", () => {
        requests.push({
          authorization: request.headers.authorization,
          session: request.headers["x-opencode-session"] as string | undefined,
          userAgent: request.headers["user-agent"],
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapturedRequest["body"],
        });
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(chunk("Pi"));
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
    if (typeof address !== "object" || address === null)
      throw new Error("Missing test server address");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const config = resolveAgentModelConfig({
      UNSPOOL_MODEL_PROVIDER: "opencode-go",
      UNSPOOL_MODEL_BASE_URL: baseUrl,
      UNSPOOL_MODEL_ID: "kimi-k3",
      UNSPOOL_MODEL_API_KEY_REF: `file:${secretPath}`,
    });
    const events: AgentWorkerEvent[] = [];
    const worker = createAgentSessionWorker({
      config,
      agentDir,
      emit: (event) => {
        events.push(event);
      },
    });
    cleanups.push(() => worker.close());
    await worker.start({
      runId: "run-real-1",
      attemptId: "attempt-real-1",
      attemptEpoch: 1,
      workspaceId: "workspace-real-1",
      conversationId: "conversation-real-1",
      cwd,
      goal: "Prove the real Pi session can connect",
      instruction: "Reply with Pi connected",
    });
    await worker.waitForIdle("run-real-1");

    expect(
      events.filter((event) => event.kind === "message.completed").map((event) => event.text),
    ).toContain("Pi connected");
    expect(events.some((event) => event.kind === "run.completed")).toBe(true);
    expect(events.some((event) => event.kind === "run.failed")).toBe(false);
    expect(requests.length).toBeGreaterThan(0);
    const request = requests[0];
    expect(request?.authorization).toBe(`Bearer ${validationOnlyKey}`);
    expect(request?.session).toBe("conversation-real-1");
    expect(request?.userAgent).toBe("unspool/0.1.0");
    expect(request?.body.model).toBe("kimi-k3");
    expect(JSON.stringify(events)).not.toContain(validationOnlyKey);
  });
});
