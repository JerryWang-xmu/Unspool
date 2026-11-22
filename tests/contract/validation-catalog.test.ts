import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const CATALOG_PATH = "specs/001-agent-federated-collaboration/uat-catalog.md";
const QUICKSTART_PATH = "specs/001-agent-federated-collaboration/quickstart.md";

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(
    existsSync(absolute),
    `Phase 2 implementation is missing: ${relativePath}. T014/T015 expect the per-ID registry to exist.`,
  );
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

const uatIds = Array.from(
  { length: 60 },
  (_, index) => `UAT-${String(index + 1).padStart(2, "0")}`,
);
const toIds = Array.from({ length: 13 }, (_, index) => `TO-${String(index + 1).padStart(2, "0")}`);
const tIds = Array.from({ length: 20 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`);
const allExpectedIds = [...uatIds, ...toIds, ...tIds];

function expectedStage(id: string): "stable" | "beta-b0" | "beta-b1" {
  const numeric = Number(id.replace(/^[A-Z]+-?/, ""));
  if (id.startsWith("UAT-")) {
    if (numeric <= 31) return "stable";
    if (
      (numeric >= 32 && numeric <= 42) ||
      (numeric >= 49 && numeric <= 51) ||
      [55, 57, 59, 60].includes(numeric)
    ) {
      return "beta-b0";
    }
    return "beta-b1";
  }
  if (id.startsWith("TO-")) {
    if (numeric <= 6) return "stable";
    if (numeric === 12) return "beta-b1";
    return "beta-b0";
  }
  if (numeric <= 10 || [15, 18, 19, 20].includes(numeric)) return "beta-b0";
  return "beta-b1";
}

function expectedSuite(id: string): "uat" | "to" | "t" {
  if (id.startsWith("UAT-")) return "uat";
  if (id.startsWith("TO-")) return "to";
  return "t";
}

function expandQuickstartReferences(text: string): string[] {
  const references = new Set<string>();
  const pattern = /QS-(\d{2})(?:\.(\d+)(?:\s*[–-]\s*(\d+))?)?/g;
  for (const match of text.matchAll(pattern)) {
    if (match[2] === undefined) {
      references.add(`QS-${match[1]}`);
      continue;
    }
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : start;
    for (let value = start; value <= end; value += 1) {
      references.add(`QS-${match[1]}.${value}`);
    }
  }
  return [...references];
}

function catalogRows(): Map<string, string> {
  const catalog = readFileSync(resolve(ROOT, CATALOG_PATH), "utf8");
  const rows = new Map<string, string>();
  for (const line of catalog.split(/\r?\n/)) {
    const match = line.match(/^\|\s*(UAT-\d{2}|TO-\d{2}|T\d{2})\s*\|(.*)\|$/);
    if (match) {
      assert.equal(rows.has(match[1]), false, `duplicate catalog row: ${match[1]}`);
      rows.set(match[1], match[2]);
    }
  }
  return rows;
}

test("the UAT/TO/T catalog contains every required ID exactly once", () => {
  const catalog = readFileSync(resolve(ROOT, CATALOG_PATH), "utf8");
  const ids = Array.from(
    catalog.matchAll(/^\|\s*(UAT-\d{2}|TO-\d{2}|T\d{2})\s*\|/gm),
    (match) => match[1],
  );
  assert.equal(ids.length, allExpectedIds.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), [...allExpectedIds].sort());

  const quickstart = readFileSync(resolve(ROOT, QUICKSTART_PATH), "utf8");
  for (const scenario of ["QS-07", "QS-08", "QS-09", "QS-10"]) {
    assert.ok(quickstart.includes(scenario), `quickstart.md must define ${scenario}`);
  }
});

test("the registry has one independent case for every UAT, TO, and T identifier", async () => {
  const registry = await loadModule("packages/test-support/src/validation-cases.ts");
  assert.ok(
    Array.isArray(registry.validationCases),
    "validation-cases.ts must export validationCases as an array",
  );
  assert.equal(registry.validationCases.length, allExpectedIds.length);
  const ids = registry.validationCases.map((entry: { id: string }) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "registry IDs must be unique");
  assert.deepEqual([...ids].sort(), [...allExpectedIds].sort());

  const rows = catalogRows();
  for (const entry of registry.validationCases) {
    assert.ok(rows.has(entry.id), `registry contains an uncatalogued ID: ${entry.id}`);
    assert.equal(String(entry.suite).toLowerCase(), expectedSuite(entry.id), entry.id);
    assert.equal(String(entry.stage).toLowerCase(), expectedStage(entry.id), entry.id);

    for (const field of ["prepare", "action", "expected", "positiveControl", "negativeControl"]) {
      assert.equal(
        typeof entry[field],
        "string",
        `${entry.id}.${field} must describe an independent case`,
      );
      assert.ok(entry[field].trim().length > 0, `${entry.id}.${field} must not be empty`);
    }
    assert.notEqual(entry.prepare, entry.quickstart, `${entry.id} cannot only link to QS`);
    assert.notEqual(entry.action, entry.quickstart, `${entry.id} cannot only link to QS`);
    assert.equal(
      entry.evidencePath,
      `artifacts/validation/cases/${entry.id}/summary.json`,
      `${entry.id} must write independent evidence`,
    );

    const quickstartReferences = Array.isArray(entry.quickstart)
      ? entry.quickstart
      : [entry.quickstart];
    assert.ok(quickstartReferences.length > 0, `${entry.id} must name its QS fixture`);
    const catalogReferences = new Set(expandQuickstartReferences(rows.get(entry.id) ?? ""));
    for (const reference of quickstartReferences) {
      assert.ok(
        catalogReferences.has(reference),
        `${entry.id} references ${reference}, which is not listed in its catalog row`,
      );
    }
  }
});

test("B0 cases cannot carry B1 tool or Patch capabilities", async () => {
  const registry = await loadModule("packages/test-support/src/validation-cases.ts");
  const b1OnlyCapabilities = new Set([
    "fixed_tool_execution",
    "patch_application",
    "cross_domain_artifact",
  ]);
  const b0Cases = registry.validationCases.filter(
    (entry: { stage: string }) => String(entry.stage).toLowerCase() === "beta-b0",
  );
  const b1Cases = registry.validationCases.filter(
    (entry: { stage: string }) => String(entry.stage).toLowerCase() === "beta-b1",
  );

  assert.ok(b0Cases.length > 0);
  assert.ok(b1Cases.length > 0);
  for (const entry of b0Cases) {
    const capabilities: string[] = entry.capabilities ?? [];
    for (const capability of capabilities) {
      assert.equal(
        b1OnlyCapabilities.has(capability),
        false,
        `${entry.id} is B0 but declares B1 capability ${capability}`,
      );
    }
    const references = Array.isArray(entry.quickstart) ? entry.quickstart : [entry.quickstart];
    assert.equal(
      references.some(
        (reference: string) => reference.startsWith("QS-09") || reference.startsWith("QS-10"),
      ),
      false,
      `${entry.id} is B0 and cannot depend on B1 scenarios`,
    );
  }

  const b1Capabilities = new Set(
    b1Cases.flatMap((entry: { capabilities?: string[] }) => entry.capabilities ?? []),
  );
  for (const capability of b1OnlyCapabilities) {
    assert.ok(
      b1Capabilities.has(capability),
      `B1 registry must include a ${capability} case so B0 evidence cannot be spoofed`,
    );
  }
});

test("stage gates require complete B0 evidence before B1 and never the reverse", async () => {
  const registry = await loadModule("packages/test-support/src/validation-cases.ts");
  assert.equal(
    typeof registry.stagePrerequisites,
    "function",
    "validation-cases.ts must export stagePrerequisites(stage)",
  );

  assert.deepEqual([...registry.stagePrerequisites("stable")], []);
  assert.deepEqual([...registry.stagePrerequisites("beta-b0")], []);
  const b1Prerequisites = [...registry.stagePrerequisites("beta-b1")];
  assert.ok(b1Prerequisites.includes("beta-b0"));
  assert.equal(b1Prerequisites.includes("beta-b1"), false);
  assert.equal([...registry.stagePrerequisites("beta-b0")].includes("beta-b1"), false);

  assert.equal(registry.getValidationCase("UAT-01")?.id, "UAT-01");
  assert.equal(registry.getValidationCase("TO-13")?.id, "TO-13");
  assert.equal(registry.getValidationCase("T20")?.id, "T20");
  assert.equal(registry.getValidationCase("UAT-61"), undefined);
});
