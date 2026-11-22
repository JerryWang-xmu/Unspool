import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../../apps/runner-api/src/index";
import { createAnalyticsStore } from "../../../apps/runner-api/src/telemetry/analytics-store";
import { createRedactedLogger } from "../../../apps/runner-api/src/telemetry/logging";
import { uuidv7 } from "../../../packages/security/src/uuid";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const OWNER = "validation-owner";
const OUTSIDER = "validation-outsider";
const CANARY = "FEDERATED-PRIVATE-CANARY";
const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const command = (payload: Record<string, unknown>) => ({
  schemaVersion: 1,
  commandId: randomUUID(),
  payloadDigest: digest(payload),
  ...payload,
});
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("unauthorized federated canary channels", () => {
  it("does not expose private content through workspace, events, downloads, logs or analytics", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "unspool-unauthorized-channels-"));
    directories.push(dataDir);
    const server = await buildServer({
      dataDir,
      ownerToken: OWNER,
      additionalTokens: { [OUTSIDER]: { id: "outsider", displayName: "Outsider" } },
    });
    try {
      const runners = await server.inject({
        method: "GET",
        url: "/v1/runners",
        headers: auth(OWNER),
      });
      const runnerId = runners.json().runners[0].id as string;
      const profiles = await server.inject({
        method: "GET",
        url: `/v1/runners/${runnerId}/model-profiles`,
        headers: auth(OWNER),
      });
      const agentProfileId = profiles.json().modelProfiles[0].id as string;
      const created = await server.inject({
        method: "POST",
        url: "/v1/personal-tasks",
        headers: { ...auth(OWNER), "idempotency-key": randomUUID() },
        body: command({
          name: "Private source",
          goal: "Secret",
          completionCriteria: "No leaks",
          runnerId,
          agentProfileId,
        }),
      });
      expect(created.statusCode, created.body).toBe(201);
      const workspaceId = created.json().workspace.id as string;
      const context = await server.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/context-items`,
        headers: { ...auth(OWNER), "idempotency-key": randomUUID() },
        body: command({
          kind: "fact",
          title: CANARY,
          body: CANARY,
          memberVisibility: "private",
          agentExposure: "not_provided",
          sourceRefs: [],
        }),
      });
      expect(context.statusCode).toBe(201);
      const bytes = new TextEncoder().encode(CANARY);
      const metadata = {
        name: "private.md",
        mediaType: "text/markdown",
        size: bytes.byteLength,
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        kind: "reference",
        sourceSummary: CANARY,
      };
      const form = new FormData();
      form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("content", new Blob([bytes]), "private.md");
      const uploaded = await server.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/artifacts`,
        headers: { ...auth(OWNER), "idempotency-key": randomUUID() },
        body: form,
      });
      expect(uploaded.statusCode).toBe(201);
      const artifactId = uploaded.json().artifact.artifactId as string;
      const paths = [
        `/v1/workspaces/${workspaceId}`,
        `/v1/workspaces/${workspaceId}/context-items`,
        `/v1/workspaces/${workspaceId}/events`,
        `/v1/workspaces/${workspaceId}/artifacts/${artifactId}/content`,
        `/v1/workspaces/${workspaceId}/archive-search?q=${CANARY}`,
      ];
      for (const path of paths) {
        const response = await server.inject({ method: "GET", url: path, headers: auth(OUTSIDER) });
        expect([403, 404], path).toContain(response.statusCode);
        expect(response.body).not.toContain(CANARY);
      }
      const records: unknown[] = [];
      const logger = createRedactedLogger({ write: (record) => records.push(record) });
      logger.info("federation.private", { body: CANARY, nested: { path: "D:/secret/file.txt" } });
      expect(JSON.stringify(records)).not.toContain(CANARY);
      expect(JSON.stringify(records)).not.toContain("D:/secret/file.txt");
      const analytics = createAnalyticsStore(join(dataDir, "analytics.jsonl"));
      await analytics.record({
        eventName: "federation.result",
        occurredAt: new Date().toISOString(),
        metadata: { outcome: "denied" },
      });
      await expect(
        analytics.record({
          eventName: "invalid",
          occurredAt: new Date().toISOString(),
          metadata: { body: CANARY },
        }),
      ).rejects.toThrow();
      expect(JSON.stringify(await analytics.exportMetadata())).not.toContain(CANARY);
    } finally {
      await server.close();
    }
  });
});
