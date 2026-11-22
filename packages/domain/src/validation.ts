export type JsonObject = Record<string, unknown>;

export function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as JsonObject;
}

export function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, name);
}

export function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

export function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

export function textArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return [...value];
}

export function objectArray(value: unknown, name: string): JsonObject[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item, index) => object(item, `${name}[${index}]`));
}

export function timestamp(value: unknown, name: string): string {
  const parsed = text(value, name);
  if (Number.isNaN(Date.parse(parsed)))
    throw new TypeError(`${name} must be an RFC 3339 timestamp`);
  return parsed;
}

export function optionalTimestamp(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, name);
}
