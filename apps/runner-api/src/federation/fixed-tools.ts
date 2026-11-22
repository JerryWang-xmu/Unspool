import type {
  B1FixedToolParameterSchema,
  B1FixedToolTemplate,
  B1ResourceBudget,
  B1ResourceUsage,
} from "../../../../packages/test-support/src/federation/tool-fixtures.js";

export class FixedToolRegistry {
  readonly #templates = new Map<string, B1FixedToolTemplate>();

  register(template: B1FixedToolTemplate): B1FixedToolTemplate {
    const existing = this.#templates.get(template.id);
    if (existing !== undefined && existing.digest !== template.digest)
      throw new Error("template_reauthorization_required");
    this.#templates.set(template.id, template);
    return template;
  }

  get(templateId: string): B1FixedToolTemplate {
    const template = this.#templates.get(templateId);
    if (template === undefined) throw new Error("template_not_found");
    return template;
  }
}

function validateArguments(
  schema: B1FixedToolParameterSchema,
  args: unknown,
): Record<string, string> {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    throw new Error("invalid_arguments");
  const record = args as Record<string, unknown>;
  const allowed = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(record))
    if (!allowed.has(key)) throw new Error("invalid_arguments");
  for (const required of schema.required)
    if (record[required] === undefined) throw new Error("invalid_arguments");
  const normalized: Record<string, string> = {};
  for (const [key, definition] of Object.entries(schema.properties)) {
    const value = record[key];
    if (value !== undefined && (typeof value !== "string" || !definition.enum.includes(value)))
      throw new Error("invalid_arguments");
    if (typeof value === "string") normalized[key] = value;
  }
  return normalized;
}

function assertBudget(budget: B1ResourceBudget, usage: B1ResourceUsage): void {
  if (
    usage.files > budget.maxFiles ||
    usage.bytes > budget.maxBytes ||
    usage.readBytes > budget.maxReadBytes ||
    usage.outputBytes > budget.maxOutputBytes ||
    usage.durationSeconds > budget.maxDurationSeconds ||
    usage.concurrent > budget.maxConcurrent ||
    usage.cpuMillicpu > budget.cpuMillicpu ||
    usage.memoryMb > budget.memoryMb ||
    usage.processes > budget.processes
  ) {
    const error = new Error("budget_exhausted");
    Object.assign(error, { status: 429, autoRaiseBudget: false });
    throw error;
  }
}

export class FixedToolSandbox {
  execute(input: {
    readonly template: B1FixedToolTemplate;
    readonly templateDigest: string;
    readonly arguments: unknown;
    readonly usage?: B1ResourceUsage;
  }) {
    const request = input as unknown as Record<string, unknown>;
    if (request.network !== undefined && request.network !== "disabled")
      throw new Error("network_denied");
    for (const key of Object.keys(request)) {
      if (!["template", "templateId", "templateDigest", "arguments", "usage"].includes(key))
        throw new Error("invalid_request");
    }
    if (input.template.digest !== input.templateDigest) throw new Error("template_digest_mismatch");
    if (input.template.networkPolicy !== "disabled") throw new Error("network_denied");
    const args = validateArguments(input.template.parameterSchema, input.arguments);
    const usage = input.usage ?? {
      files: 0,
      bytes: 0,
      readBytes: 0,
      outputBytes: 1,
      durationSeconds: 1,
      concurrent: 1,
      cpuMillicpu: 1,
      memoryMb: 1,
      processes: 1,
    };
    assertBudget(input.template.budget, usage);
    const suite = args.suite;
    if (suite === undefined) throw new Error("invalid_arguments");
    const output = `fixed-suite:${suite}:passed`;
    if (output.length > input.template.outputLimit) throw new Error("budget_exhausted");
    return {
      state: "succeeded" as const,
      output,
      outputArtifactId: `artifact-${suite}`,
      environment: {} as Record<string, never>,
      networkAccesses: 0,
      shellInvocations: 0,
      processGroupTerminated: false,
      workingScope: input.template.workingScope,
    };
  }

  inspectSandbox(template: B1FixedToolTemplate) {
    return {
      environment: {},
      envAllowlist: [...template.envAllowlist],
      networkPolicy: template.networkPolicy,
      networkAccesses: 0,
      shellInvocations: 0,
      processGroupIsolation: true,
      workingScope: template.workingScope,
    };
  }
}
