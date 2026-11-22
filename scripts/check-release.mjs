import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = process.cwd();
const checks = [];
function run(name, command, args, env = {}) {
  const useCmd = process.platform === "win32" && command === "npm";
  const result = spawnSync(
    useCmd ? "cmd.exe" : command,
    useCmd ? ["/d", "/s", "/c", "npm", ...args] : args,
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
  checks.push({
    name,
    status: result.status,
    output:
      `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`.slice(
        -1000,
      ),
  });
}
function file(name, path) {
  const exists = existsSync(new URL(path, import.meta.url));
  checks.push({
    name,
    status: exists ? 0 : 1,
    output: exists ? `${path} present` : `${path} missing`,
  });
}
function review(name, path, requiredPhrases) {
  const text = existsSync(new URL(path, import.meta.url))
    ? readFileSync(new URL(path, import.meta.url), "utf8")
    : "";
  const missing = requiredPhrases.filter((phrase) => !text.includes(phrase));
  checks.push({
    name,
    status: missing.length === 0 ? 0 : 1,
    output: missing.length === 0 ? `${path} complete` : `missing: ${missing.join(", ")}`,
  });
}

const npm = "npm";
run("types", npm, ["run", "check:types"]);
run("secrets", npm, ["run", "test:security"]);
run("compose", npm, ["run", "validate:compose"], { UNSPOOL_OWNER_TOKEN: "validation-only" });
run("build", npm, ["run", "build"]);
file("sbom", "../SBOM.md");
file("third-party", "../THIRD_PARTY.md");
file("provenance", "../docs/design/provenance.md");
review("license-attribution", "../THIRD_PARTY.md", ["MIT", "license"]);
review("pi-similarity", "../docs/design/provenance.md", ["similarity", "proprietary"]);

const report = { generatedAt: new Date().toISOString(), checks };
console.log(JSON.stringify(report, null, 2));
if (checks.some((check) => check.status !== 0)) process.exitCode = 1;
