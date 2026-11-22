import { Buffer } from "node:buffer";

/**
 * Minimal multipart/form-data reader for artifact uploads. The parser keeps
 * every part in memory because the Runner enforces a small, configurable upload
 * limit before any part is persisted.
 */

export interface MultipartPart {
  readonly name: string;
  readonly filename?: string | undefined;
  readonly contentType?: string | undefined;
  readonly data: Buffer;
}

export interface MultipartFormData {
  readonly fields: ReadonlyMap<string, MultipartPart>;
}

export class MultipartParseError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MultipartParseError";
  }
}

const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");
const PART_DELIMITER_PREFIX = Buffer.from("\r\n--");

function parseBoundary(contentType: string): string {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2])?.trim();

  if (boundary === undefined || boundary.length === 0 || boundary.length > 70) {
    throw new MultipartParseError("A multipart boundary is required.");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: This validator intentionally rejects control characters.
  if (/[\r\n\u0000]/.test(boundary)) {
    throw new MultipartParseError("The multipart boundary contains invalid characters.");
  }

  return boundary;
}

function headerParameter(value: string, parameter: string): string | undefined {
  const quoted = new RegExp(`(?:^|;)\\s*${parameter}="((?:[^"\\\\]|\\\\.)*)"`, "i").exec(value);
  if (quoted?.[1] !== undefined) {
    return quoted[1].replace(/\\(.)/g, "$1");
  }

  const bare = new RegExp(`(?:^|;)\\s*${parameter}=([^;]*)`, "i").exec(value);
  const result = bare?.[1]?.trim();
  return result === undefined || result.length === 0 ? undefined : result;
}

interface PartHeaders {
  readonly disposition: string;
  readonly contentType?: string | undefined;
}

function parsePartHeaders(block: string): PartHeaders {
  let disposition: string | undefined;
  let contentType: string | undefined;

  for (const line of block.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "content-disposition") disposition = value;
    if (name === "content-type") contentType = value;
  }

  if (disposition === undefined) {
    throw new MultipartParseError("Each multipart part needs a Content-Disposition header.");
  }
  if (!/^form-data(?:\s*;|$)/i.test(disposition)) {
    throw new MultipartParseError("Multipart parts must use form-data dispositions.");
  }

  return { disposition, ...(contentType === undefined ? {} : { contentType }) };
}

function isDelimiterBoundary(body: Buffer, marker: Buffer, index: number): boolean {
  let cursor = index + marker.length;
  while (body[cursor] === 32 || body[cursor] === 9) cursor += 1;

  return (
    (body[cursor] === 45 && body[cursor + 1] === 45) ||
    (body[cursor] === 13 && body[cursor + 1] === 10) ||
    body[cursor] === 10
  );
}

function findNextDelimiter(body: Buffer, marker: Buffer, from: number): number {
  let index = body.indexOf(marker, from);
  while (index >= 0) {
    if (isDelimiterBoundary(body, marker, index)) return index;
    index = body.indexOf(marker, index + 1);
  }
  return -1;
}

export function parseMultipartFormData(body: Buffer, contentType: string): MultipartFormData {
  const boundary = parseBoundary(contentType);
  const delimiter = Buffer.from(`--${boundary}`);
  const nextDelimiter = Buffer.concat([PART_DELIMITER_PREFIX, Buffer.from(boundary)]);

  let cursor = body.indexOf(delimiter);
  if (cursor < 0) {
    throw new MultipartParseError("The multipart body does not contain its boundary.");
  }

  const fields = new Map<string, MultipartPart>();
  while (true) {
    cursor += delimiter.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;

    while (body[cursor] === 32 || body[cursor] === 9) cursor += 1;
    if (body[cursor] === 13 && body[cursor + 1] === 10) {
      cursor += 2;
    } else if (body[cursor] === 10) {
      cursor += 1;
    } else {
      throw new MultipartParseError("A multipart boundary is not followed by a part.");
    }

    const headerEnd = body.indexOf(HEADER_SEPARATOR, cursor);
    if (headerEnd < 0) {
      throw new MultipartParseError("A multipart part is missing its header terminator.");
    }

    const headers = parsePartHeaders(body.subarray(cursor, headerEnd).toString("utf8"));
    const name = headerParameter(headers.disposition, "name");
    if (name === undefined) {
      throw new MultipartParseError("Each multipart part needs a field name.");
    }
    if (fields.has(name)) {
      throw new MultipartParseError("Multipart fields must be unique.");
    }

    const dataStart = headerEnd + HEADER_SEPARATOR.length;
    const boundaryStart = findNextDelimiter(body, nextDelimiter, dataStart);
    if (boundaryStart < 0) {
      throw new MultipartParseError("A multipart part is missing its closing boundary.");
    }

    const filename = headerParameter(headers.disposition, "filename");
    fields.set(name, {
      name,
      ...(filename === undefined ? {} : { filename }),
      ...(headers.contentType === undefined ? {} : { contentType: headers.contentType }),
      data: body.subarray(dataStart, boundaryStart),
    });

    cursor = boundaryStart + 2;
  }

  return { fields };
}
