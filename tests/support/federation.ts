import { expect } from "vitest";

export type FederationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { status: number; code: string; detail?: string } };

export function expectOk<T>(result: FederationResult<T>): T {
  if (!result.ok)
    throw new Error(
      `Expected federation success, received ${result.error.code}: ${result.error.detail ?? ""}`,
    );
  return result.value;
}

export function expectError(result: FederationResult<unknown>, code?: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected federation rejection, received success");
  if (code !== undefined) expect(result.error.code).toBe(code);
}
