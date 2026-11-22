import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFixedToolRunner,
  type FixedToolDigest,
  type FixedToolResourceBudget,
  type FixedToolRunner,
  type FixedToolTemplate,
  type FixedToolTemplateBody,
  sha256Digest,
  withCanonicalTemplateDigest,
} from "../../../apps/execution-worker/src/fixed-tool-runner.js";
import { createExecutionWorkerServer } from "../../../apps/execution-worker/src/server.js";
import { B1_FIXED_TOOL_TEMPLATE } from "../../../packages/test-support/src/federation/tool-fixtures.js";

const fixedSuitePath = fileURLToPath(
  new URL("../../../apps/execution-worker/src/fixed-suite.mjs", import.meta.url),
);

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

async function makeRunner(): Promise<{ runner: FixedToolRunner; tmpRoot: string }> {
  const tmpRoot = await mkdtemp(join(tmpdir(), "unspool-b1-process-"));
  const runner = await createFixedToolRunner({ fixedSuitePath, tmpRoot });
  cleanups.push(async () => {
    await runner.close();
    await rm(tmpRoot, { recursive: true, force: true });
  });
  return { runner, tmpRoot };
}

async function makeTemplate(
  overrides: {
    readonly outputLimit?: number;
    readonly budget?: Partial<FixedToolResourceBudget>;
  } = {},
): Promise<FixedToolTemplate> {
  const executableDigest = sha256Digest(await readFile(fixedSuitePath));
  const { digest: _fixtureDigest, ...fixture } = B1_FIXED_TOOL_TEMPLATE;
  const body: FixedToolTemplateBody = {
    ...fixture,
    executableDigest,
    outputLimit: overrides.outputLimit ?? fixture.outputLimit,
    budget: { ...fixture.budget, ...overrides.budget },
  };
  return withCanonicalTemplateDigest(body);
}

function invocation(template: FixedToolTemplate, suite: string) {
  return {
    templateId: template.id,
    templateDigest: template.digest,
    arguments: { suite },
  };
}

async function expectFailureCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected failure code ${code}`);
}

function expectThrowsCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected failure code ${code}`);
}

describe("US6 fixed-tool process execution", () => {
  it("runs the registered suite in a real child process with empty environment", async () => {
    const { runner, tmpRoot } = await makeRunner();
    const template = await makeTemplate();
    runner.register(template);

    const result = await runner.execute(invocation(template, "unit"));

    expect(result.state).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    expect(result.processId).toEqual(expect.any(Number));
    expect(result.output).toContain("fixed-suite:unit:passed");
    expect(result.stderr).toBe("");
    expect(result.environment).toEqual({});
    expect(result.hostEnvironmentInherited).toBe(process.platform === "win32");
    expect(result.shellInvocations).toBe(0);
    expect(result.networkAccesses).toBe(0);
    const observedEnvironmentKeys = result.artifact?.value.environmentKeys ?? [];
    for (const forbidden of [
      "B1_FIXTURE_CANARY",
      "AWS_SECRET_ACCESS_KEY",
      "OPENAI_API_KEY",
      "DOCKER_HOST",
    ]) {
      expect(observedEnvironmentKeys).not.toContain(forbidden);
    }
    if (process.platform !== "win32") expect(observedEnvironmentKeys).toEqual([]);
    expect(result.artifact?.value).toMatchObject({
      suite: "unit",
      status: "passed",
    });
    expect(result.usage.files).toBe(2);
    expect(result.usage.bytes).toBeGreaterThan(0);
    expect(result.usage.readBytes).toBeGreaterThan(0);
    expect(result.usage.outputBytes).toBe(result.outputBytes);
    expect(result.workingDirectory).toBe("fresh-isolated-temp");
    expect(result.workingDirectoryRemoved).toBe(true);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("rejects arbitrary arguments, request fields, and caller digests before spawn", async () => {
    const { runner, tmpRoot } = await makeRunner();
    const template = await makeTemplate();
    runner.register(template);
    const before = runner.getStats().totalSpawned;

    for (const args of [
      { suite: "unit; /bin/sh -c id" },
      { suite: "unit", argv: ["-c", "id"] },
      { suite: "unit", command: "id" },
      { suite: "unit", network: "enabled" },
      { suite: "integration", environment: { B1_FIXTURE_CANARY: "not-a-secret" } },
    ]) {
      await expectFailureCode(
        runner.execute({
          templateId: template.id,
          templateDigest: template.digest,
          arguments: args,
        }),
        "invalid_arguments",
      );
    }

    await expectFailureCode(
      runner.execute({
        templateId: template.id,
        templateDigest: template.digest,
        arguments: { suite: "unit" },
        argv: ["-c", "id"],
      }),
      "invalid_request",
    );
    await expectFailureCode(
      runner.execute({
        templateId: template.id,
        templateDigest: `sha256:${"0".repeat(64)}`,
        arguments: { suite: "unit" },
      }),
      "template_digest_mismatch",
    );

    expect(runner.getStats().totalSpawned).toBe(before);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("rejects caller-supplied template and executable digests at registration", async () => {
    const { runner } = await makeRunner();
    const template = await makeTemplate();

    expectThrowsCode(
      () => runner.register({ ...template, digest: `sha256:${"0".repeat(64)}` }),
      "template_digest_mismatch",
    );
    expectThrowsCode(
      () =>
        runner.register({
          ...template,
          executableDigest: `sha256:${"1".repeat(64)}` as FixedToolDigest,
        }),
      "executable_digest_mismatch",
    );
    expect(runner.getStats().registeredTemplates).toBe(0);
  });

  it("fails a run whose output exceeds the registered output limit", async () => {
    const { runner } = await makeRunner();
    const template = await makeTemplate({ outputLimit: 8, budget: { maxOutputBytes: 8 } });
    runner.register(template);

    const result = await runner.execute(invocation(template, "unit"));

    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("output_limit_exceeded");
    expect(result.outputBytes).toBeGreaterThan(8);
    expect(result.timedOut).toBe(false);
    expect(result.workingDirectoryRemoved).toBe(true);
  });

  it("kills a wall-timed-out process and reports no success", async () => {
    const { runner } = await makeRunner();
    const template = await makeTemplate({ budget: { maxDurationSeconds: 1 } });
    runner.register(template);

    const result = await runner.execute(invocation(template, "integration"));

    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("wall_timeout");
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(900);
    expect(result.durationMs).toBeLessThan(5_000);
    if (process.platform === "linux") expect(result.processGroupTerminated).toBe(true);
  });

  it("leaves no run directory or environment state for the next run", async () => {
    const { runner, tmpRoot } = await makeRunner();
    const template = await makeTemplate();
    runner.register(template);

    const first = await runner.execute(invocation(template, "unit"));
    const second = await runner.execute(invocation(template, "unit"));

    expect(first.state).toBe("succeeded");
    expect(second.state).toBe("succeeded");
    expect(first.runId).not.toBe(second.runId);
    const observedEnvironmentKeys = second.artifact?.value.environmentKeys ?? [];
    for (const forbidden of [
      "B1_FIXTURE_CANARY",
      "AWS_SECRET_ACCESS_KEY",
      "OPENAI_API_KEY",
      "DOCKER_HOST",
    ]) {
      expect(observedEnvironmentKeys).not.toContain(forbidden);
    }
    if (process.platform !== "win32") expect(observedEnvironmentKeys).toEqual([]);
    expect(second.environment).toEqual({});
    expect(second.usage.files).toBe(2);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("caps concurrency without spawning a second process", async () => {
    const { runner } = await makeRunner();
    const template = await makeTemplate();
    runner.register(template);

    const settled = await Promise.allSettled([
      runner.execute(invocation(template, "unit")),
      runner.execute(invocation(template, "unit")),
    ]);

    expect(settled[0]?.status).toBe("fulfilled");
    expect(settled[1]?.status).toBe("rejected");
    if (settled[1]?.status === "rejected") {
      expect(settled[1].reason).toMatchObject({ code: "concurrency_limit_exceeded" });
    }
    expect(runner.getStats().totalSpawned).toBe(1);
  });

  it("serves healthz, registration validation, execution, and inspection over JSON", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "unspool-b1-server-"));
    const worker = await createExecutionWorkerServer({
      fixedSuitePath,
      host: "127.0.0.1",
      port: 0,
      tmpRoot,
    });
    cleanups.push(async () => {
      await worker.close();
      await rm(tmpRoot, { recursive: true, force: true });
    });
    const address = await worker.listen();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: "ok",
      service: "unspool-execution-worker",
      environmentPolicy: "empty",
    });

    const template = await makeTemplate();
    const registered = await fetch(`${baseUrl}/templates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(template),
    });
    expect(registered.status).toBe(201);

    const tampered = await fetch(`${baseUrl}/templates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...template, digest: `sha256:${"0".repeat(64)}` }),
    });
    expect(tampered.status).toBe(409);
    expect(await tampered.json()).toMatchObject({ error: { code: "template_digest_mismatch" } });

    const executed = await fetch(`${baseUrl}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invocation(template, "unit")),
    });
    expect(executed.status).toBe(200);
    const executedBody = (await executed.json()) as {
      readonly value: {
        readonly state: string;
        readonly usage: { readonly files: number };
        readonly artifact: {
          readonly value: { readonly environmentKeys: readonly string[] };
        } | null;
      };
    };
    expect(executedBody.value.state).toBe("succeeded");
    expect(executedBody.value.usage.files).toBe(2);
    const observedEnvironmentKeys = executedBody.value.artifact?.value.environmentKeys ?? [];
    for (const forbidden of [
      "B1_FIXTURE_CANARY",
      "AWS_SECRET_ACCESS_KEY",
      "OPENAI_API_KEY",
      "DOCKER_HOST",
    ]) {
      expect(observedEnvironmentKeys).not.toContain(forbidden);
    }
    if (process.platform !== "win32") expect(observedEnvironmentKeys).toEqual([]);

    const inspected = await fetch(`${baseUrl}/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: template.id }),
    });
    expect(inspected.status).toBe(200);
    const inspectedBody = (await inspected.json()) as {
      readonly value: {
        readonly sandbox: {
          readonly environment: unknown;
          readonly envAllowlist: unknown;
          readonly dockerSocketPath: unknown;
          readonly shellInvocations: unknown;
        };
      };
    };
    expect(inspectedBody.value.sandbox).toMatchObject({
      environment: {},
      envAllowlist: [],
      dockerSocketPath: null,
      shellInvocations: 0,
    });

    const rejected = await fetch(`${baseUrl}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...invocation(template, "unit"),
        argv: ["-c", "id"],
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(worker.runner.getStats().totalSpawned).toBe(1);
  });
});
