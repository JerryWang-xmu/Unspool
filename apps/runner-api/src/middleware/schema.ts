import { type Static, Type } from "@sinclair/typebox";
import { type ValueError, ValueErrorType } from "@sinclair/typebox/errors";
import { Value } from "@sinclair/typebox/value";

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const DIGEST_PATTERN = "^sha256:[0-9a-f]{64}$";

const Uuid = Type.String({ pattern: UUID_PATTERN });
const Digest = Type.String({ pattern: DIGEST_PATTERN });

export const CommandEnvelopeSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    commandId: Uuid,
    actorId: Uuid,
    workspaceId: Uuid,
    payloadDigest: Digest,
    kind: Type.Union([
      Type.Literal("start"),
      Type.Literal("steer"),
      Type.Literal("follow_up"),
      Type.Literal("stop"),
      Type.Literal("queue_action"),
    ]),
    expectedRevision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CommandEnvelope = Static<typeof CommandEnvelopeSchema>;

const contractSchemas: Record<string, typeof CommandEnvelopeSchema> = {
  CommandEnvelope: CommandEnvelopeSchema,
};

export interface ContractFieldError {
  path: string;
  message: string;
}

export interface ContractProblem {
  type: string;
  title: string;
  status: 400;
  code: "invalid_request";
  detail: string;
  retryable: false;
  errors: ContractFieldError[];
}

export type ContractValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; problem: ContractProblem };

export function describeValueError(error: ValueError): string {
  switch (error.type) {
    case ValueErrorType.ObjectRequiredProperty:
      return "Required field is missing.";
    case ValueErrorType.ObjectAdditionalProperties:
      return "Field is not allowed by the contract.";
    case ValueErrorType.Literal:
      return "Value is not the supported literal.";
    case ValueErrorType.Union:
      return "Value is not one of the allowed options.";
    case ValueErrorType.StringPattern:
      return "Value does not match the required format.";
    case ValueErrorType.String:
      return "Expected a string.";
    case ValueErrorType.Integer:
      return "Expected an integer.";
    case ValueErrorType.IntegerMinimum:
      return "Value is below the allowed minimum.";
    case ValueErrorType.StringMinLength:
      return "Value is too short.";
    case ValueErrorType.StringMaxLength:
      return "Value is too long.";
    default:
      return "Value is invalid.";
  }
}

const invalidRequest = (
  detail: string,
  errors: ContractFieldError[],
): ContractValidationResult => ({
  ok: false,
  problem: {
    type: "https://unspool.dev/problems/invalid-request",
    title: "Invalid request",
    status: 400,
    code: "invalid_request",
    detail,
    retryable: false,
    errors,
  },
});

export function validateContractValue(
  schemaName: string,
  value: unknown,
): ContractValidationResult {
  const schema = contractSchemas[schemaName];
  if (schema === undefined) {
    return invalidRequest("Unknown contract schema.", [{ path: "/", message: "Unknown schema." }]);
  }

  if (Value.Check(schema, value)) {
    return { ok: true, value };
  }

  const errors = new Map<string, ContractFieldError>();
  for (const error of Value.Errors(schema, value)) {
    const path = error.path.length > 0 ? error.path : "/";
    if (!errors.has(path)) {
      errors.set(path, { path, message: describeValueError(error) });
    }
  }

  return invalidRequest(
    `The value does not satisfy the ${schemaName} contract.`,
    errors.size > 0 ? [...errors.values()] : [{ path: "/", message: "Value is invalid." }],
  );
}
