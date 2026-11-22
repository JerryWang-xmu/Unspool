import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { getHealthStatus } from "../../../apps/runner-api/src/routes/health.ts";
import { createAnalyticsStore } from "../../../apps/runner-api/src/telemetry/analytics-store.ts";
import {
  createRedactedLogger,
  sanitizeMetadata,
} from "../../../apps/runner-api/src/telemetry/logging.ts";

test("health reports capabilities and degraded dependencies without secrets", () => {
  const healthy = getHealthStatus([{ name: "database", healthy: true }]);
  assert.equal(healthy.status, "ok");
  assert.equal(healthy.maxUploadBytes, 20 * 1024 * 1024);
  assert.equal(healthy.maxActiveRunsPerWorkspace, 1);
  assert.equal(healthy.maxContributorNodesPerWorkspace, 5);

  const degraded = getHealthStatus([
    { name: "model-gateway", healthy: false, detail: "unavailable" },
  ]);
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.dependencies[0].detail, "unavailable");
  assert.equal(JSON.stringify(degraded).includes("password"), false);
});

test("logger redacts secrets and removes content recursively", () => {
  const records: unknown[] = [];
  const logger = createRedactedLogger({ write: (record) => records.push(record) });
  logger.info("test", {
    token: "secret-value",
    nested: { path: "/secret/file", count: 2 },
    body: "private text",
    allowed: true,
  });
  const record = records[0] as { metadata: Record<string, unknown> };
  assert.equal(record.metadata.token, "<redacted>");
  assert.deepEqual(record.metadata.nested, { path: "<content-removed>", count: 2 });
  assert.equal(record.metadata.body, "<content-removed>");
  assert.equal(record.metadata.allowed, true);
  assert.equal(JSON.stringify(record).includes("secret-value"), false);
  assert.equal(JSON.stringify(record).includes("private text"), false);
  assert.deepEqual(sanitizeMetadata({ a: [{ secret: "x" }] }), { a: [{ secret: "<redacted>" }] });
});

test("analytics store accepts only scalar behavioral metadata and persists separately", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "unspool-analytics-")), "events.jsonl");
  const store = createAnalyticsStore(file);
  await store.record({
    eventName: "personal_task_completed",
    occurredAt: "2026-11-22T10:00:00.000Z",
    metadata: { runnerType: "local", usedTools: true },
  });
  await store.record({
    eventName: "handoff_completed",
    occurredAt: "2026-11-22T10:01:00.000Z",
    metadata: { durationMs: 1200, accepted: true },
  });

  assert.equal((await store.query("personal_task_completed")).length, 1);
  assert.equal((await store.exportMetadata()).length, 2);
  await assert.rejects(
    store.record({ eventName: "bad", occurredAt: "now", metadata: { body: "secret" } }),
    /body/,
  );
  await assert.rejects(
    store.record({ eventName: "bad", occurredAt: "now", metadata: { nested: { no: true } } }),
    /scalar/,
  );
});
