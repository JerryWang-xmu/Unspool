import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const composePath = "deploy/docker/compose.yml";
const compose = readFileSync(composePath, "utf8");

function block(start: string, end: string): string {
  const from = compose.indexOf(start);
  const to = compose.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Compose block is missing: ${start}`);
  return compose.slice(from, to);
}

describe("US3 compromised-worker egress boundary", () => {
  it.each(["execution-worker-1", "execution-worker-2"])(
    "%s has no control/model network or host port",
    (worker) => {
      const next = worker === "execution-worker-1" ? "  execution-worker-2:" : "  model-gateway:";
      const source = block(`  ${worker}:`, next);
      expect(source).toContain("networks:\n      - execution");
      expect(source).not.toContain("- control");
      expect(source).not.toContain("UNSPOOL_MODEL_GATEWAY_URL");
      expect(source).not.toContain("UNSPOOL_FAUX_MODEL_URL");
      expect(source).not.toMatch(/\n {4}ports:/);
      expect(source).toContain("read_only: true");
      expect(source).toContain("cap_drop:\n      - ALL");
      expect(source).toContain("no-new-privileges:true");
    },
  );

  it("isolates the internal execution network while allowing only Runner and fake-external", () => {
    expect(block("networks:\n  control:", "volumes:")).toContain(
      "execution:\n    driver: bridge\n    internal: true",
    );
    expect(block("\n  model-gateway:\n", "\n  fake-model:\n")).toContain("- control");
    expect(block("\n  model-gateway:\n", "\n  fake-model:\n")).not.toContain("- execution");
    expect(block("\n  fake-model:\n", "\n  fake-external:\n")).toContain("- control");
    expect(block("\n  fake-external:\n", "\nnetworks:\n")).toContain("- execution");
    expect(block("\n  runner-api:\n", "\n  execution-worker-1:\n")).toContain(
      "- control\n      - execution",
    );
  });

  it("passes Docker Compose validation", () => {
    const result = spawnSync(
      "docker",
      ["compose", "-f", composePath, "--profile", "validation", "config", "--quiet"],
      { encoding: "utf8", env: { ...process.env, UNSPOOL_OWNER_TOKEN: "validation-only" } },
    );
    if (result.error?.code === "ENOENT") {
      expect(compose).toContain("internal: true");
      return;
    }
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects real model/external bypass attempts from a compromised worker when the validation stack is enabled", () => {
    if (process.env.UNSPOOL_TEST_WORKER_BYPASS !== "1") {
      expect(compose).toContain("internal: true");
      return;
    }
    for (const url of ["http://model-gateway:8080/healthz", "https://example.com/"]) {
      const result = spawnSync(
        "docker",
        [
          "compose",
          "-f",
          composePath,
          "--profile",
          "validation",
          "exec",
          "-T",
          "execution-worker-1",
          "node",
          "-e",
          `fetch('${url}').then(()=>process.exit(0)).catch(()=>process.exit(1))`,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      expect(
        result.status,
        `Compromised worker unexpectedly reached ${url}: ${result.stdout}${result.stderr}`,
      ).not.toBe(0);
    }
    const allowed = spawnSync(
      "docker",
      [
        "compose",
        "-f",
        composePath,
        "--profile",
        "validation",
        "exec",
        "-T",
        "execution-worker-1",
        "node",
        "-e",
        "fetch('http://fake-external:8080/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
    expect(allowed.status, allowed.stderr).toBe(0);
  }, 90_000);
});
