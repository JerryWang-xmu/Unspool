const SECRET_KEY = "<redacted>";
const CONTENT_REMOVED = "<content-removed>";
const UNSUPPORTED_VALUE = "<unsupported-value>";
const MAX_LOG_STRING_LENGTH = 256;
const MAX_LOG_DEPTH = 4;
const MAX_LOG_FIELDS = 32;
const MAX_LOG_ARRAY_ITEMS = 8;
const SAFE_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,15}$/;

const SECRET_FIELD_NAMES = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "credentials",
  "authorization",
  "cookie",
  "setcookie",
  "apikey",
  "privatekey",
  "sessionsecret",
  "accesstoken",
  "refreshtoken",
]);

const CONTENT_FIELD_NAMES = new Set([
  "body",
  "content",
  "text",
  "message",
  "prompt",
  "instruction",
  "discussion",
  "question",
  "answer",
  "privateqa",
  "file",
  "filename",
  "filepath",
  "path",
  "paths",
  "args",
  "arguments",
  "canonicalargs",
  "toolargs",
  "parameters",
  "payload",
  "transcript",
  "outbound",
  "command",
  "commandtext",
]);

const CONTENT_FIELD_SUFFIXES = [
  "body",
  "content",
  "message",
  "prompt",
  "instruction",
  "discussion",
  "question",
  "answer",
  "privateqa",
  "file",
  "filename",
  "filepath",
  "path",
  "args",
  "arguments",
  "canonicalargs",
  "toolargs",
  "parameters",
  "payload",
  "transcript",
  "outbound",
] as const;

const CONTENT_FIELD_PREFIXES = [
  "instruction",
  "discussion",
  "question",
  "answer",
  "privateqa",
  "prompt",
  "transcript",
  "payload",
] as const;

// Replace credentials first so a header value is removed as one unit.
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(password|passwd|secret|token|api[_-]?key|authorization|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n]+)/gi;
const FILE_URI_PATTERN = /\bfile:\/\/[^\s]+/gi;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;
const UNC_PATH_PATTERN = /\\\\[^\s\\]+\\[^\s\\]+(?:\\[^\s\\]*)*/g;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]*/g;
const POSIX_PATH_PATTERN = /(?<![\w:.])\/(?:[\w.@-]+\/)+[\w.@-]+/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Log sanitization intentionally targets the control range.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]+/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretField(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SECRET_FIELD_NAMES.has(normalized) ||
    normalized.startsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("token") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("privatekey")
  );
}

function isContentField(key: string): boolean {
  const normalized = normalizeKey(key);
  if (CONTENT_FIELD_NAMES.has(normalized)) {
    return true;
  }
  if (CONTENT_FIELD_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  return CONTENT_FIELD_PREFIXES.some(
    (prefix) =>
      normalized.startsWith(prefix) &&
      (normalized.endsWith("text") ||
        normalized.endsWith("body") ||
        normalized.endsWith("content")),
  );
}

function truncate(value: string, maxLength = MAX_LOG_STRING_LENGTH): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

/**
 * Removes credentials, URLs, filesystem paths, email addresses, and control
 * characters from a free-text log value. Long values are truncated so a
 * conversation body cannot be smuggled through an innocuous field name.
 */
export function redactLogText(value: string, maxLength = MAX_LOG_STRING_LENGTH): string {
  const redacted = value
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(FILE_URI_PATTERN, "[redacted-url]")
    .replace(URL_PATTERN, "[redacted-url]")
    .replace(UNC_PATH_PATTERN, "[redacted-path]")
    .replace(WINDOWS_PATH_PATTERN, "[redacted-path]")
    .replace(POSIX_PATH_PATTERN, "[redacted-path]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .trim();

  return truncate(redacted, maxLength);
}

function sanitizeValue(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key !== undefined) {
    if (isSecretField(key)) {
      return SECRET_KEY;
    }
    if (isContentField(key)) {
      return CONTENT_REMOVED;
    }
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactLogText(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : UNSUPPORTED_VALUE;
  }
  if (typeof value === "bigint") {
    return redactLogText(value.toString());
  }
  if (typeof value !== "object") {
    return UNSUPPORTED_VALUE;
  }
  if (seen.has(value)) {
    return "<redacted-circular>";
  }
  if (depth >= MAX_LOG_DEPTH) {
    return "<redacted-depth>";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_LOG_ARRAY_ITEMS) {
      return "<redacted-list>";
    }
    return value.map((item) => sanitizeValue(item, undefined, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  let fieldCount = 0;
  for (const [childKey, childValue] of Object.entries(value)) {
    if (fieldCount >= MAX_LOG_FIELDS) {
      break;
    }
    if (!SAFE_FIELD_PATTERN.test(childKey)) {
      continue;
    }
    sanitized[childKey] = sanitizeValue(childValue, childKey, depth + 1, seen);
    fieldCount += 1;
  }
  return sanitized;
}

/**
 * Sanitizes one metadata object. Content-bearing keys are replaced with
 * explicit markers; scalar values are still scrubbed because a path or token
 * can be hidden under an otherwise harmless key.
 */
export function sanitizeMetadata(value: unknown, key?: string): unknown {
  return sanitizeValue(value, key, 0, new WeakSet());
}

export interface LogRecord {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly occurredAt: string;
  readonly metadata: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void | Promise<void>;
}

export interface RedactedLogger {
  log(level: LogRecord["level"], event: string, metadata?: Record<string, unknown>): void;
  debug(event: string, metadata?: Record<string, unknown>): void;
  info(event: string, metadata?: Record<string, unknown>): void;
  warn(event: string, metadata?: Record<string, unknown>): void;
  error(event: string, metadata?: Record<string, unknown>): void;
}

function writeToStdout(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function sanitizeEventName(event: string): string {
  return typeof event === "string" && EVENT_NAME_PATTERN.test(event) ? event : "invalid_event";
}

function sanitizeMetadataObject(metadata: unknown): Record<string, unknown> {
  const sanitized = sanitizeMetadata(metadata);
  if (sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }
  return sanitized as Record<string, unknown>;
}

export function createRedactedLogger(sink: LogSink = { write: writeToStdout }): RedactedLogger {
  const write = (
    level: LogRecord["level"],
    event: string,
    metadata: Record<string, unknown> = {},
  ): void => {
    const record: LogRecord = Object.freeze({
      level,
      event: sanitizeEventName(event),
      occurredAt: new Date().toISOString(),
      metadata: sanitizeMetadataObject(metadata),
    });

    try {
      const result = sink.write(record);
      if (result !== undefined) {
        void result.catch(() => undefined);
      }
    } catch {
      // Logging must never turn an operational failure into a request failure.
    }
  };

  return {
    log: write,
    debug: (event, metadata) => {
      write("debug", event, metadata);
    },
    info: (event, metadata) => {
      write("info", event, metadata);
    },
    warn: (event, metadata) => {
      write("warn", event, metadata);
    },
    error: (event, metadata) => {
      write("error", event, metadata);
    },
  };
}
