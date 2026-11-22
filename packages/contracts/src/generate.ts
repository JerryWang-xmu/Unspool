export type JsonSchema = Record<string, unknown>;

export interface SchemaCompatibilityChange {
  path: string;
  message: string;
}

export interface SchemaCompatibilityResult {
  compatible: boolean;
  breakingChanges: SchemaCompatibilityChange[];
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description?: string }>;
  security: Array<Record<string, string[]>>;
  tags: Array<{ name: string }>;
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, JsonSchema>;
    responses: Record<string, unknown>;
    parameters: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
}

const isSchemaObject = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const escapePointerSegment = (segment: string): string =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");

const joinPointer = (path: string, segment: string): string =>
  `${path}/${escapePointerSegment(segment)}`;

const propertyPath = (path: string, property: string): string =>
  joinPointer(joinPointer(path, "properties"), property);

const valuesOf = (schema: JsonSchema, keyword: string): unknown[] | undefined =>
  Array.isArray(schema[keyword]) ? schema[keyword] : undefined;

const stringSet = (value: unknown): Set<string> =>
  new Set(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
  );

const serializeValue = (value: unknown): string => JSON.stringify(value) ?? String(value);

const compareEnums = (
  previous: unknown[] | undefined,
  next: unknown[] | undefined,
  path: string,
  breakingChanges: SchemaCompatibilityChange[],
): void => {
  if (previous === undefined && next === undefined) {
    return;
  }
  if (previous === undefined || next === undefined) {
    breakingChanges.push({
      path,
      message: "Enum constraints must not be added or removed within a major version.",
    });
    return;
  }

  const previousValues = new Set(previous.map(serializeValue));
  const nextValues = new Set(next.map(serializeValue));
  const added = next.filter((value) => !previousValues.has(serializeValue(value)));
  const removed = previous.filter((value) => !nextValues.has(serializeValue(value)));

  if (added.length > 0) {
    breakingChanges.push({
      path,
      message: `Enum values cannot be expanded: ${added.map(serializeValue).join(", ")}.`,
    });
  }
  if (removed.length > 0) {
    breakingChanges.push({
      path,
      message: `Enum values cannot be removed: ${removed.map(serializeValue).join(", ")}.`,
    });
  }
};

const compareSchemas = (
  previous: JsonSchema,
  next: JsonSchema,
  path: string,
  breakingChanges: SchemaCompatibilityChange[],
): void => {
  const previousReference = previous.$ref;
  const nextReference = next.$ref;
  if (typeof previousReference === "string" || typeof nextReference === "string") {
    if (previousReference !== nextReference) {
      breakingChanges.push({ path, message: "Schema reference changed." });
    }
    return;
  }

  const previousType = previous.type;
  const nextType = next.type;
  if (
    previousType !== undefined &&
    nextType !== undefined &&
    serializeValue(previousType) !== serializeValue(nextType)
  ) {
    breakingChanges.push({ path, message: "Schema type changed." });
    return;
  }

  if ("const" in previous || "const" in next) {
    if (
      "const" in previous &&
      "const" in next &&
      serializeValue(previous.const) !== serializeValue(next.const)
    ) {
      breakingChanges.push({ path, message: "Constant value changed." });
    }
  }

  compareEnums(valuesOf(previous, "enum"), valuesOf(next, "enum"), path, breakingChanges);

  const previousRequired = stringSet(previous.required);
  const nextRequired = stringSet(next.required);
  for (const required of nextRequired) {
    if (!previousRequired.has(required)) {
      breakingChanges.push({
        path: propertyPath(path, required),
        message: `Required field added: ${required}.`,
      });
    }
  }

  const previousProperties = isSchemaObject(previous.properties) ? previous.properties : {};
  const nextProperties = isSchemaObject(next.properties) ? next.properties : {};
  for (const [name, previousProperty] of Object.entries(previousProperties)) {
    const nextProperty = nextProperties[name];
    if (!isSchemaObject(nextProperty)) {
      breakingChanges.push({
        path: propertyPath(path, name),
        message: `Property removed: ${name}.`,
      });
      continue;
    }
    if (isSchemaObject(previousProperty)) {
      compareSchemas(previousProperty, nextProperty, propertyPath(path, name), breakingChanges);
    }
  }

  const previousAdditional = previous.additionalProperties;
  const nextAdditional = next.additionalProperties;
  if (previousAdditional !== false && nextAdditional === false) {
    breakingChanges.push({ path, message: "Additional properties can no longer be accepted." });
  } else if (isSchemaObject(previousAdditional) && isSchemaObject(nextAdditional)) {
    compareSchemas(previousAdditional, nextAdditional, path, breakingChanges);
  }

  if (isSchemaObject(previous.items) && isSchemaObject(next.items)) {
    compareSchemas(previous.items, next.items, joinPointer(path, "items"), breakingChanges);
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const previousBranches = valuesOf(previous, keyword);
    const nextBranches = valuesOf(next, keyword);
    if (previousBranches === undefined || nextBranches === undefined) {
      continue;
    }
    if (previousBranches.length !== nextBranches.length) {
      breakingChanges.push({ path, message: `${keyword} branches changed.` });
      continue;
    }
    for (const [index, previousBranch] of previousBranches.entries()) {
      const nextBranch = nextBranches[index];
      if (isSchemaObject(previousBranch) && isSchemaObject(nextBranch)) {
        compareSchemas(
          previousBranch,
          nextBranch,
          joinPointer(path, `${keyword}/${index}`),
          breakingChanges,
        );
      }
    }
  }
};

export function checkSchemaCompatibility(
  previous: JsonSchema,
  next: JsonSchema,
): SchemaCompatibilityResult {
  const breakingChanges: SchemaCompatibilityChange[] = [];
  compareSchemas(previous, next, "#", breakingChanges);
  return { compatible: breakingChanges.length === 0, breakingChanges };
}

const DigestSchema: JsonSchema = {
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
  description: "JCS-canonicalized SHA-256 digest.",
};

const UuidSchema: JsonSchema = {
  type: "string",
  format: "uuid",
};

const CommandEnvelopeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "commandId",
    "actorId",
    "workspaceId",
    "payloadDigest",
    "kind",
    "expectedRevision",
  ],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    commandId: { $ref: "#/components/schemas/Uuid" },
    actorId: { $ref: "#/components/schemas/Uuid" },
    workspaceId: { $ref: "#/components/schemas/Uuid" },
    payloadDigest: { $ref: "#/components/schemas/Digest" },
    kind: {
      type: "string",
      enum: ["start", "steer", "follow_up", "stop", "queue_action"],
    },
    expectedRevision: { type: "integer", format: "int64", minimum: 0 },
  },
};

const FieldErrorSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "message"],
  properties: {
    path: { type: "string" },
    message: { type: "string" },
  },
};

const ProblemSchema: JsonSchema = {
  type: "object",
  required: ["type", "title", "status", "code", "detail", "retryable"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string" },
    status: { type: "integer" },
    code: { type: "string" },
    detail: { type: "string" },
    instance: { type: "string" },
    retryable: { type: "boolean" },
    revision: { type: "integer", format: "int64" },
    errors: { type: "array", items: { $ref: "#/components/schemas/FieldError" } },
  },
};

const HealthSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "version"],
  properties: {
    status: { const: "ok" },
    service: { const: "runner-api" },
    version: { type: "string" },
  },
};

const RunSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "workspaceId", "state", "operatorEpoch", "contextSnapshotId"],
  properties: {
    id: { $ref: "#/components/schemas/Uuid" },
    workspaceId: { $ref: "#/components/schemas/Uuid" },
    state: {
      type: "string",
      enum: [
        "created",
        "running",
        "waiting_approval",
        "stopping",
        "technical_complete",
        "failed",
        "cancelled",
        "needs_confirmation",
      ],
    },
    operatorEpoch: { type: "integer", format: "int64", minimum: 0 },
    contextSnapshotId: { $ref: "#/components/schemas/Uuid" },
  },
};

const AcceptedSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["commandId", "state", "revision"],
  properties: {
    commandId: { $ref: "#/components/schemas/Uuid" },
    state: { type: "string", enum: ["accepted", "outcome_unknown"] },
    revision: { type: "integer", format: "int64", minimum: 0 },
    operationRef: { type: "string" },
  },
};

const schemaReference = (name: string): JsonSchema => ({
  $ref: `#/components/schemas/${name}`,
});

export function generateOpenApiDocument(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "Unspool Runner API",
      version: "1.0.0",
      description:
        "Versioned contract for the desktop GUI, runner administration, and workspace commands.",
    },
    servers: [{ url: "https://runner.example.test/v1" }],
    security: [{ sessionAuth: [] }],
    tags: [{ name: "Discovery" }, { name: "Runs" }],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          tags: ["Discovery"],
          security: [],
          responses: {
            200: { $ref: "#/components/responses/Health" },
            default: { $ref: "#/components/responses/Problem" },
          },
        },
      },
      "/workspaces/{workspaceId}/runs": {
        post: {
          operationId: "startRun",
          tags: ["Runs"],
          parameters: [
            { $ref: "#/components/parameters/WorkspaceId" },
            { $ref: "#/components/parameters/IdempotencyKey" },
            { $ref: "#/components/parameters/IfMatch" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CommandEnvelope" },
              },
            },
          },
          responses: {
            202: { $ref: "#/components/responses/RunAccepted" },
            default: { $ref: "#/components/responses/Problem" },
          },
        },
      },
    },
    components: {
      schemas: {
        Digest: DigestSchema,
        Uuid: UuidSchema,
        CommandEnvelope: CommandEnvelopeSchema,
        FieldError: FieldErrorSchema,
        Problem: ProblemSchema,
        Health: HealthSchema,
        Run: RunSchema,
        Accepted: AcceptedSchema,
      },
      responses: {
        Health: {
          description: "Runner health, version, capabilities, and deployment limits.",
          content: {
            "application/json": { schema: schemaReference("Health") },
          },
        },
        RunAccepted: {
          description: "The command was accepted and persisted; agent work has not completed.",
          content: {
            "application/json": { schema: schemaReference("Run") },
          },
        },
        Accepted: {
          description: "The command was accepted and persisted.",
          content: {
            "application/json": { schema: schemaReference("Accepted") },
          },
        },
        Problem: {
          description: "Redacted RFC 9457 problem response.",
          content: {
            "application/problem+json": { schema: schemaReference("Problem") },
          },
        },
      },
      parameters: {
        WorkspaceId: {
          name: "workspaceId",
          in: "path",
          required: true,
          schema: schemaReference("Uuid"),
        },
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: schemaReference("Uuid"),
        },
        IfMatch: {
          name: "If-Match",
          in: "header",
          required: true,
          schema: { type: "string", pattern: '^"[0-9]+"$' },
        },
      },
      securitySchemes: {
        sessionAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque-runner-session",
        },
      },
    },
  };
}
