import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createFixedToolRunner,
  FixedToolError,
  type FixedToolRunner,
} from "./fixed-tool-runner.js";

const MAX_BODY_BYTES = 64 * 1024;

export interface ExecutionWorkerServerOptions {
  readonly fixedSuitePath?: string;
  readonly host?: string;
  readonly port?: number;
  readonly tmpRoot?: string;
}

export interface ExecutionWorkerServer {
  readonly runner: FixedToolRunner;
  listen(): Promise<{ readonly host: string; readonly port: number }>;
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof FixedToolError) {
    sendJson(response, error.status, {
      ok: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  sendJson(response, 500, {
    ok: false,
    error: { code: "internal_error", message: "Internal execution worker error" },
  });
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(new FixedToolError("payload_too_large", "JSON body is too large", 413));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new FixedToolError("invalid_json", "Body must be valid JSON", 400));
      }
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runner: FixedToolRunner,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, {
      status: "ok",
      service: "unspool-execution-worker",
      fixedSuiteDigest: runner.executableDigest,
      registeredTemplates: runner.getStats().registeredTemplates,
      environmentPolicy: "empty",
      networkPolicy: "disabled",
      shell: "disabled",
    });
    return;
  }

  if (request.method !== "POST") {
    throw new FixedToolError("method_not_allowed", "Only GET /healthz is supported", 405);
  }

  if (url.pathname === "/templates") {
    const template = runner.register(await readJsonBody(request));
    sendJson(response, 201, { ok: true, value: template });
    return;
  }

  if (url.pathname === "/execute") {
    const result = await runner.execute(await readJsonBody(request));
    sendJson(response, 200, { ok: true, value: result });
    return;
  }

  if (url.pathname === "/inspect") {
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new FixedToolError("invalid_request", "Inspect request must be an object", 400);
    }
    for (const key of Object.keys(body)) {
      if (key !== "templateId") {
        throw new FixedToolError("invalid_request", `Inspect field ${key} is not allowed`, 400);
      }
    }
    sendJson(response, 200, { ok: true, value: runner.inspect(body.templateId) });
    return;
  }

  throw new FixedToolError("not_found", "Endpoint not found", 404);
}

export async function createExecutionWorkerServer(
  options: ExecutionWorkerServerOptions = {},
): Promise<ExecutionWorkerServer> {
  const fixedSuitePath =
    options.fixedSuitePath ?? fileURLToPath(new URL("./fixed-suite.mjs", import.meta.url));
  const runner = await createFixedToolRunner({
    fixedSuitePath,
    ...(options.tmpRoot === undefined ? {} : { tmpRoot: options.tmpRoot }),
  });
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;

  const server = createServer((request, response) => {
    handleRequest(request, response, runner).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendError(response, error);
    });
  });

  return {
    runner,

    listen(): Promise<{ readonly host: string; readonly port: number }> {
      return new Promise((resolvePromise, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          const address = server.address();
          if (typeof address === "object" && address !== null) {
            resolvePromise({ host: address.address, port: address.port });
            return;
          }
          reject(new Error("Execution worker did not bind a TCP address"));
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
    },

    async close(): Promise<void> {
      await runner.close();
      if (!server.listening) return;
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error === undefined) resolvePromise();
          else reject(error);
        });
      });
    },
  };
}

function readPort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  const fixedSuitePath = process.env.UNSPOOL_FIXED_SUITE_PATH;
  const worker = await createExecutionWorkerServer({
    host: (process.env.HOST ?? "").trim() || "0.0.0.0",
    port: readPort(process.env.PORT ?? "8080"),
    ...(fixedSuitePath === undefined ? {} : { fixedSuitePath }),
  });
  const address = await worker.listen();
  console.log(`unspool execution worker listening on ${address.host}:${address.port}`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void worker
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
