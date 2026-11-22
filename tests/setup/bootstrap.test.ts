import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("clean checkout contains the planned personal-MVP scaffold", () => {
  for (const path of [
    "package.json",
    "Cargo.toml",
    "apps/desktop",
    "apps/runner-api",
    "apps/execution-worker",
    "apps/model-gateway",
    "packages/contracts",
    "packages/domain",
    "packages/persistence",
    "packages/security",
    "packages/test-support",
    "deploy/docker/compose.yml",
    ".gitignore",
    ".dockerignore",
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
  }

  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.devDependencies.typescript, "7.0.2");
  assert.equal(packageJson.dependencies["@earendil-works/pi-coding-agent"], "1.6.0");
  assert.match(String(packageJson.engines.node), /24/);
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22);
});

test("Team and federation crates are not personal-MVP prerequisites", () => {
  const workspace = read("package.json");
  assert.equal(workspace.includes("apps/contributor-node"), false);
});
