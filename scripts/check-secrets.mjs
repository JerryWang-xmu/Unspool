import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

const SKIP_DIRECTORIES = new Set([
  ".codegraph",
  ".git",
  ".opencode",
  ".specify",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "PRD",
  "references",
  "specs",
  "target",
  "test-results",
]);

const SKIP_FILES = new Set(["package-lock.json"]);

const RULES = [
  {
    name: "PEM private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "OpenAI-style API key",
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  },
  {
    name: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
];

const files = [];

const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        walk(join(directory, entry.name));
      }
      continue;
    }

    if (!entry.isFile() || SKIP_FILES.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);

    if (statSync(path).size <= 2 * 1024 * 1024) {
      files.push(path);
    }
  }
};

walk(ROOT);

const findings = [];

for (const file of files) {
  let text;

  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (text.includes("\u0000")) {
    continue;
  }

  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push(
          `${relative(ROOT, file).split(sep).join("/")}:${index + 1} matched ${rule.name}`,
        );
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Potential committed secrets detected:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log("Secret scan passed: no plaintext credential patterns found.");
}
