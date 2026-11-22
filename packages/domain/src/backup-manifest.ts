import { createHash } from "node:crypto";
import type { JsonObject } from "./validation.js";
import { integer, object, objectArray, text, timestamp } from "./validation.js";

export interface BackupManifest {
  id: string;
  appVersion: string;
  schemaVersion: number;
  lastWorkspaceSequences: Record<string, number>;
  objectEntries: JsonObject[];
  sessionEntries: JsonObject[];
  databaseEntry?: JsonObject | undefined;
  createdAt: string;
  digest: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function backupManifestDigest(manifest: Omit<BackupManifest, "digest">): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(manifest)), "utf8")
    .digest("hex")}`;
}

export function parseBackupManifest(value: unknown): BackupManifest {
  const input = object(value, "BackupManifest");
  const lastWorkspaceSequences = Object.fromEntries(
    Object.entries(
      object(input.lastWorkspaceSequences, "BackupManifest.lastWorkspaceSequences"),
    ).map(([workspaceId, sequence]) => [
      workspaceId,
      integer(sequence, `BackupManifest.lastWorkspaceSequences.${workspaceId}`, 0),
    ]),
  );
  const manifest: BackupManifest = {
    id: text(input.id, "BackupManifest.id"),
    appVersion: text(input.appVersion, "BackupManifest.appVersion"),
    schemaVersion: integer(input.schemaVersion, "BackupManifest.schemaVersion", 1),
    lastWorkspaceSequences,
    objectEntries: objectArray(input.objectEntries, "BackupManifest.objectEntries"),
    sessionEntries: objectArray(input.sessionEntries, "BackupManifest.sessionEntries"),
    ...(input.databaseEntry === undefined
      ? {}
      : { databaseEntry: object(input.databaseEntry, "BackupManifest.databaseEntry") }),
    createdAt: timestamp(input.createdAt, "BackupManifest.createdAt"),
    digest: text(input.digest, "BackupManifest.digest"),
  };
  const { digest: _ignored, ...withoutDigest } = manifest;
  if (manifest.digest !== backupManifestDigest(withoutDigest))
    throw new TypeError("BackupManifest.digest does not match the manifest contents");
  return manifest;
}
