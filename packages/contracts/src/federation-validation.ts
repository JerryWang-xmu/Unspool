import { createHash } from "node:crypto";

export function fedObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function fedText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

export function fedDigest(value: unknown, name: string): string {
  const text = fedText(value, name);
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`);
  return text;
}

export function fedStrings(value: unknown, name: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  )
    throw new TypeError(`${name} must contain strings`);
  if (new Set(value).size !== value.length)
    throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze([...value]);
}

export function fedInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return value;
}

export function fedTime(value: unknown, name: string): string {
  const text = fedText(value, name);
  if (!Number.isFinite(Date.parse(text)))
    throw new TypeError(`${name} must be an RFC3339 timestamp`);
  return text;
}

export function fedBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  return value;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

export function federationDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
