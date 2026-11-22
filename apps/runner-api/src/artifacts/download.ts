/**
 * HTTP helpers for artifact downloads. Ranges are deliberately limited to a
 * single byte range; multipart ranges are not part of the Runner contract.
 */

export type ParsedByteRange =
  | { readonly kind: "full" }
  | { readonly kind: "partial"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/i;
const RFC5987_UNRESERVED = /^[A-Za-z0-9!#$&+.^_`|~-]$/;

export function parseRangeHeader(value: string | undefined, size: number): ParsedByteRange {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("Artifact size must be a non-negative safe integer.");
  }

  if (value === undefined || value.trim().length === 0) {
    return { kind: "full" };
  }
  if (value.includes(",")) {
    return { kind: "unsatisfiable" };
  }

  const match = RANGE_PATTERN.exec(value.trim());
  if (match === null) {
    return { kind: "unsatisfiable" };
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText.length === 0 && endText.length === 0) {
    return { kind: "unsatisfiable" };
  }

  if (startText.length === 0) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) {
      return { kind: "unsatisfiable" };
    }
    return {
      kind: "partial",
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return { kind: "unsatisfiable" };
  }

  const end = endText.length === 0 ? size - 1 : Number(endText);
  if (!Number.isSafeInteger(end) || end < start) {
    return { kind: "unsatisfiable" };
  }

  return { kind: "partial", start, end: Math.min(end, size - 1) };
}

function encodeRFC5987(value: string): string {
  let encoded = "";
  for (const character of value) {
    encoded += RFC5987_UNRESERVED.test(character)
      ? character
      : encodeURIComponent(character).replace(
          /['()*]/g,
          (item) => `%${item.charCodeAt(0).toString(16).toUpperCase()}`,
        );
  }
  return encoded;
}

/**
 * Always produces an attachment disposition with an ASCII fallback, so a
 * crafted display name cannot inject headers or force inline rendering.
 */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const fallback = ascii.length > 0 ? ascii : "artifact";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(name)}`;
}
