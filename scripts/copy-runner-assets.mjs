import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "packages/persistence/schema");
const destination = resolve(root, "apps/runner-api/dist/packages/persistence/schema");
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, force: true });

const fixedSuiteSource = resolve(root, "apps/execution-worker/src/fixed-suite.mjs");
const fixedSuiteDestination = resolve(
  root,
  "apps/runner-api/dist/apps/execution-worker/src/fixed-suite.mjs",
);
await mkdir(dirname(fixedSuiteDestination), { recursive: true });
await cp(fixedSuiteSource, fixedSuiteDestination, { force: true });
