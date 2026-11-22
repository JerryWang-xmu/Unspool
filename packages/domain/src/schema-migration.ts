import { integer, object, optionalText, text, timestamp } from "./validation.js";

export interface SchemaMigration {
  version: number;
  checksum: string;
  appliedAt: string;
  backupManifestId?: string | undefined;
}

export function parseSchemaMigration(value: unknown): SchemaMigration {
  const input = object(value, "SchemaMigration");
  return {
    version: integer(input.version, "SchemaMigration.version", 1),
    checksum: text(input.checksum, "SchemaMigration.checksum"),
    appliedAt: timestamp(input.appliedAt, "SchemaMigration.appliedAt"),
    backupManifestId: optionalText(input.backupManifestId, "SchemaMigration.backupManifestId"),
  };
}
