import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const COMMAND_ID = "018f2d8f-2001-7f20-80b1-bbbbbbbbbbb1";
const ACTOR_ID = "018f2d8f-1001-7f20-80b1-aaaaaaaaaaa1";
const WORKSPACE_ID = "018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4";

async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const absolute = resolve(ROOT, relativePath);
  assert.ok(
    existsSync(absolute),
    `Phase 2 implementation is missing: ${relativePath}. T014 expects this module to satisfy the foundation contract.`,
  );
  return (await import(pathToFileURL(absolute).href)) as Record<string, any>;
}

function resolvePointer(document: Record<string, any>, reference: string) {
  assert.ok(reference.startsWith("#/"), `unsupported external $ref: ${reference}`);
  let current: any = document;
  for (const part of reference.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    assert.ok(current && Object.hasOwn(current, key), `unresolved $ref: ${reference}`);
    current = current[key];
  }
  return current;
}

function collectReferences(value: unknown, references: string[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string") references.push(item);
      else collectReferences(item, references);
    }
  }
  return references;
}

test("generated OpenAPI is 3.1, contains schemas, and has no unresolved references", async () => {
  const generateModule = await loadModule("packages/contracts/src/generate.ts");
  assert.equal(
    typeof generateModule.generateOpenApiDocument,
    "function",
    "contracts/generate.ts must export generateOpenApiDocument()",
  );

  const document = await generateModule.generateOpenApiDocument();
  assert.equal(document.openapi, "3.1.0");
  assert.equal(typeof document.info?.version, "string");
  assert.ok(document.paths && Object.keys(document.paths).length > 0);
  assert.ok(document.components?.schemas);
  assert.ok(Object.keys(document.components.schemas).length > 0);
  for (const reference of collectReferences(document)) {
    resolvePointer(document, reference);
  }
});

test("schema compatibility accepts optional additions and rejects client-breaking changes", async () => {
  const generateModule = await loadModule("packages/contracts/src/generate.ts");
  assert.equal(
    typeof generateModule.checkSchemaCompatibility,
    "function",
    "contracts/generate.ts must export checkSchemaCompatibility(previous, next)",
  );

  const previous = {
    type: "object",
    additionalProperties: false,
    required: ["id", "status"],
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["active", "disabled"] },
    },
  };
  const optionalAddition = {
    ...previous,
    properties: {
      ...previous.properties,
      displayName: { type: "string" },
    },
  };
  assert.equal(
    generateModule.checkSchemaCompatibility(previous, optionalAddition).compatible,
    true,
  );

  const requiredAddition = {
    ...optionalAddition,
    required: ["id", "status", "displayName"],
  };
  const requiredResult = generateModule.checkSchemaCompatibility(previous, requiredAddition);
  assert.equal(requiredResult.compatible, false);
  assert.ok(
    requiredResult.breakingChanges.some((change: { path: string }) =>
      change.path.includes("displayName"),
    ),
  );

  const enumExpansion = {
    ...previous,
    properties: {
      ...previous.properties,
      status: { type: "string", enum: ["active", "disabled", "pending"] },
    },
  };
  const enumResult = generateModule.checkSchemaCompatibility(previous, enumExpansion);
  assert.equal(enumResult.compatible, false);
  assert.ok(
    enumResult.breakingChanges.some((change: { path: string }) => change.path.includes("status")),
  );

  const typeChange = {
    ...previous,
    properties: {
      id: { type: "number" },
      status: previous.properties.status,
    },
  };
  assert.equal(generateModule.checkSchemaCompatibility(previous, typeChange).compatible, false);

  const propertyRemoval = {
    ...previous,
    required: ["id"],
    properties: { id: previous.properties.id },
  };
  assert.equal(
    generateModule.checkSchemaCompatibility(previous, propertyRemoval).compatible,
    false,
  );
});

test("runtime validation rejects unknown enums, schema versions, and required fields", async () => {
  const schemaModule = await loadModule("apps/runner-api/src/middleware/schema.ts");
  assert.equal(
    typeof schemaModule.validateContractValue,
    "function",
    "middleware/schema.ts must export validateContractValue(schemaName, value)",
  );

  const valid = {
    schemaVersion: 1,
    commandId: COMMAND_ID,
    actorId: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    payloadDigest: digest("command"),
    kind: "start",
    expectedRevision: 0,
  };
  const accepted = schemaModule.validateContractValue("CommandEnvelope", valid);
  assert.equal(accepted.ok, true);

  const invalidValues = [
    ["unknown enum value", { ...valid, kind: "delete_everything" }, "/kind"],
    ["unsupported schema version", { ...valid, schemaVersion: 2 }, "/schemaVersion"],
    ["missing command id", { ...valid, commandId: undefined }, "/commandId"],
    ["malformed payload digest", { ...valid, payloadDigest: "md5:abc" }, "/payloadDigest"],
    [
      "unknown required field",
      { ...valid, unexpectedRequiredField: true },
      "/unexpectedRequiredField",
    ],
  ];

  for (const [label, value, expectedPath] of invalidValues) {
    const result = schemaModule.validateContractValue("CommandEnvelope", value);
    assert.equal(result.ok, false, `${label} must be rejected`);
    assert.equal(result.problem.status, 400, `${label} must be a 400 problem`);
    assert.equal(result.problem.code, "invalid_request", label);
    assert.ok(result.problem.errors.length > 0, `${label} must list field errors`);
    assert.ok(
      result.problem.errors.some((error: { path: string }) => error.path.includes(expectedPath)),
      `${label} must point at ${expectedPath}`,
    );
    assert.equal(JSON.stringify(result.problem).includes("stack"), false);
    assert.equal(JSON.stringify(result.problem).includes(String(value.payloadDigest)), false);
  }
});
