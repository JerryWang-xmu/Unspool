import { readFileSync } from "node:fs";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const SecretReference = Type.String({
  pattern: "^(?:file|keychain|docker-secret):[^\\s]+$",
});

const HttpUrl = Type.String({
  pattern: "^https?://[^\\s]+$",
});

export const EnvironmentSchema = Type.Object(
  {
    NODE_ENV: Type.Union([
      Type.Literal("development"),
      Type.Literal("test"),
      Type.Literal("production"),
    ]),
    HOST: Type.String({ minLength: 1 }),
    PORT: Type.Integer({ minimum: 1, maximum: 65535 }),
    UNSPOOL_DATA_DIR: Type.String({ minLength: 1 }),
    UNSPOOL_MODEL_PROVIDER: Type.Literal("faux"),
    UNSPOOL_BETA_ENABLED: Type.Boolean(),
    UNSPOOL_MODEL_GATEWAY_URL: HttpUrl,
    UNSPOOL_FAUX_MODEL_URL: HttpUrl,
    UNSPOOL_FAKE_EXTERNAL_URL: HttpUrl,
    UNSPOOL_BOOTSTRAP_SECRET_REF: Type.Optional(SecretReference),
    UNSPOOL_SESSION_SECRET_REF: Type.Optional(SecretReference),
  },
  { additionalProperties: false },
);

export type Environment = Static<typeof EnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  constructor(detail: string) {
    super(`Invalid Unspool Runner environment: ${detail}`);
    this.name = "EnvironmentValidationError";
  }
}

const parsePort = (value: string | undefined): number =>
  value === undefined ? 8080 : Number(value);

const parseBoolean = (value: string | undefined): boolean | string => {
  if (value === undefined || value === "false" || value === "0") {
    return false;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  return value;
};

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const candidate: Record<string, unknown> = {
    NODE_ENV: source.NODE_ENV ?? "development",
    HOST: source.HOST ?? "127.0.0.1",
    PORT: parsePort(source.PORT),
    UNSPOOL_DATA_DIR: source.UNSPOOL_DATA_DIR ?? ".tmp/runner",
    UNSPOOL_MODEL_PROVIDER: source.UNSPOOL_MODEL_PROVIDER ?? "faux",
    UNSPOOL_BETA_ENABLED: parseBoolean(source.UNSPOOL_BETA_ENABLED),
    UNSPOOL_MODEL_GATEWAY_URL: source.UNSPOOL_MODEL_GATEWAY_URL ?? "http://127.0.0.1:8081",
    UNSPOOL_FAUX_MODEL_URL: source.UNSPOOL_FAUX_MODEL_URL ?? "http://127.0.0.1:8082",
    UNSPOOL_FAKE_EXTERNAL_URL: source.UNSPOOL_FAKE_EXTERNAL_URL ?? "http://127.0.0.1:8083",
    ...(source.UNSPOOL_BOOTSTRAP_SECRET_REF === undefined
      ? {}
      : { UNSPOOL_BOOTSTRAP_SECRET_REF: source.UNSPOOL_BOOTSTRAP_SECRET_REF }),
    ...(source.UNSPOOL_SESSION_SECRET_REF === undefined
      ? {}
      : { UNSPOOL_SESSION_SECRET_REF: source.UNSPOOL_SESSION_SECRET_REF }),
  };

  if (!Value.Check(EnvironmentSchema, candidate)) {
    const detail = [...Value.Errors(EnvironmentSchema, candidate)]
      .map((error) => `${error.path.length > 0 ? error.path : "/"} ${error.message}`)
      .join("; ");
    throw new EnvironmentValidationError(detail);
  }

  const environment = candidate as Environment;

  if (
    environment.NODE_ENV === "production" &&
    environment.UNSPOOL_SESSION_SECRET_REF === undefined
  ) {
    throw new EnvironmentValidationError(
      "UNSPOOL_SESSION_SECRET_REF is required in production and must be a secret reference",
    );
  }

  return environment;
}

export function readSecretReference(reference: string): string {
  if (!reference.startsWith("file:")) {
    throw new EnvironmentValidationError(
      `Only file secret references can be read by the Runner, received: ${reference.split(":", 1)[0]}`,
    );
  }

  return readFileSync(reference.slice("file:".length), "utf8").trimEnd();
}
