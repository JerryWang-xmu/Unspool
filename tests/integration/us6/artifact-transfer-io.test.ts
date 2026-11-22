import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createArtifactService } from "../../../apps/runner-api/src/artifacts/service";
import { transferArtifactBytes } from "../../../apps/runner-api/src/federation/artifact-transfer-io";
import { openPersonalService } from "../../../apps/runner-api/src/personal/service";
import { uuidv7 } from "../../../packages/security/src/uuid";
import { B1_CROSS_DOMAIN_RECIPIENT } from "../../../packages/test-support/src/federation/tool-fixtures";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const digest = (value: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const RIGHTS = {
  modelDisclose: false,
  memberDisclose: false,
  publicTimeline: false,
  domainPropagate: true,
  centralCache: false,
  offlineRead: false,
} as const;

async function fixture() {
  const sourceDir = await mkdtemp(join(tmpdir(), "unspool-transfer-source-"));
  const recipientDir = await mkdtemp(join(tmpdir(), "unspool-transfer-recipient-"));
  directories.push(sourceDir, recipientDir);
  const source = await openPersonalService({ dataDir: sourceDir });
  const recipient = await openPersonalService({ dataDir: recipientDir });
  const sourceOwner = uuidv7();
  const recipientOwner = uuidv7();
  const sourceWorkspace = await source.service.createTask(
    sourceOwner,
    {
      name: "Source Artifact",
      goal: "Share safely",
      completionCriteria: "Recipient gets exact bytes",
      runnerId: uuidv7(),
      agentProfileId: uuidv7(),
      payloadDigest: digest("source"),
    },
    uuidv7(),
  );
  const recipientWorkspace = await recipient.service.createTask(
    recipientOwner,
    {
      name: "Recipient Artifact",
      goal: "Receive safely",
      completionCriteria: "No unauthorized payload",
      runnerId: uuidv7(),
      agentProfileId: uuidv7(),
      payloadDigest: digest("recipient"),
    },
    uuidv7(),
  );
  const sourceArtifacts = createArtifactService({ database: source.database, dataDir: sourceDir });
  const recipientArtifacts = createArtifactService({
    database: recipient.database,
    dataDir: recipientDir,
  });
  const bytes = new TextEncoder().encode("safe cross-owner payload");
  const workspaceId = String(sourceWorkspace.response.workspace.id);
  const recipientWorkspaceId = String(recipientWorkspace.response.workspace.id);
  const uploaded = await sourceArtifacts.upload(
    sourceOwner,
    workspaceId,
    {
      name: "evidence.md",
      mediaType: "text/markdown",
      size: bytes.byteLength,
      sha256: digest(bytes),
      kind: "reference",
      sourceSummary: "Source owner approved fixture",
    },
    bytes,
    uuidv7(),
  );
  return {
    source,
    recipient,
    sourceOwner,
    recipientOwner,
    sourceArtifacts,
    recipientArtifacts,
    workspaceId,
    recipientWorkspaceId,
    uploaded,
    bytes,
  };
}

describe("real cross-owner Artifact bytes", () => {
  it("validates policy and digest before storing exactly one recipient version", async () => {
    const f = await fixture();
    try {
      const artifact = {
        ...f.uploaded.response.artifact,
        artifactId: String(f.uploaded.response.artifact.artifactId),
        blobId: "fixture-blob",
        kind: "reference" as const,
        originType: "workspace",
        originId: f.workspaceId,
        attribution: {
          actorId: f.sourceOwner,
          displayNameAtTime: "Source Owner",
          rolesAtTime: ["owner"],
          occurredAt: new Date().toISOString(),
        },
        securityLabelId: "source-label",
        sourceSummary: "Source owner approved fixture",
        originOwnerIds: [f.sourceOwner],
        contentDigest: digest(f.bytes),
      };
      const result = await transferArtifactBytes({
        artifact,
        recipient: { ...B1_CROSS_DOMAIN_RECIPIENT, ownerId: f.recipientOwner },
        sourceLabelRights: RIGHTS,
        recipientLabelRights: RIGHTS,
        requestedRights: RIGHTS,
        loadApprovals: async () => [
          {
            approverRole: "source_owner",
            approverId: f.sourceOwner,
            decision: "approved",
            decidedAt: new Date().toISOString(),
          },
          {
            approverRole: "recipient_owner",
            approverId: f.recipientOwner,
            decision: "approved",
            decidedAt: new Date().toISOString(),
          },
        ],
        loadSource: async () => ({
          bytes: f.bytes,
          name: "evidence.md",
          mediaType: "text/markdown",
          sourceSummary: "Source owner approved fixture",
          contentDigest: digest(f.bytes),
        }),
        storeRecipient: async (source) => {
          const stored = await f.recipientArtifacts.upload(
            f.recipientOwner,
            f.recipientWorkspaceId,
            {
              name: source.name,
              mediaType: source.mediaType,
              size: source.bytes.byteLength,
              sha256: digest(source.bytes),
              kind: "reference",
              sourceSummary: source.sourceSummary,
            },
            source.bytes,
            uuidv7(),
          );
          return {
            artifactId: String(stored.response.artifact.artifactId),
            artifactVersionId: String(stored.response.artifact.artifactVersionId),
          };
        },
      });
      expect(result.recipientArtifactVersions).toBe(1);
      expect(result.recipientArtifact.artifactVersionId).not.toBe("");
      const listed = await f.recipientArtifacts.list(f.recipientOwner, f.recipientWorkspaceId);
      expect(listed.artifacts).toHaveLength(1);
      const download = await f.recipientArtifacts.content(
        f.recipientOwner,
        f.recipientWorkspaceId,
        result.recipientArtifact.artifactId,
      );
      expect(new TextDecoder().decode(download.bytes)).toBe("safe cross-owner payload");
      expect(download.artifact.sha256).toBe(digest(f.bytes));
    } finally {
      await f.source.close();
      await f.recipient.close();
    }
  });

  it("reads no source bytes and creates no recipient version without dual approval", async () => {
    const f = await fixture();
    try {
      let sourceReads = 0;
      let recipientWrites = 0;
      await expect(
        transferArtifactBytes({
          artifact: {
            ...f.uploaded.response.artifact,
            artifactId: "artifact",
            blobId: "blob",
            kind: "reference",
            originType: "workspace",
            originId: f.workspaceId,
            attribution: {
              actorId: f.sourceOwner,
              displayNameAtTime: "Owner",
              rolesAtTime: ["owner"],
              occurredAt: new Date().toISOString(),
            },
            securityLabelId: "label",
            sourceSummary: "Fixture",
            originOwnerIds: [f.sourceOwner],
            contentDigest: digest(f.bytes),
          },
          recipient: { ...B1_CROSS_DOMAIN_RECIPIENT, ownerId: f.recipientOwner },
          sourceLabelRights: RIGHTS,
          recipientLabelRights: RIGHTS,
          requestedRights: RIGHTS,
          loadApprovals: async () => [
            {
              approverRole: "source_owner",
              approverId: f.sourceOwner,
              decision: "approved",
              decidedAt: new Date().toISOString(),
            },
          ],
          loadSource: async () => {
            sourceReads += 1;
            return {
              bytes: f.bytes,
              name: "evidence.md",
              mediaType: "text/markdown",
              sourceSummary: "Fixture",
              contentDigest: digest(f.bytes),
            };
          },
          storeRecipient: async () => {
            recipientWrites += 1;
            throw new Error("must not write");
          },
        }),
      ).rejects.toThrow("recipient_approval_required");
      expect(sourceReads).toBe(0);
      expect(recipientWrites).toBe(0);
    } finally {
      await f.source.close();
      await f.recipient.close();
    }
  });
});
