import { integer, object, text, textArray, timestamp } from "./validation.js";
export interface ArchiveExport {
  id: string;
  workspaceId: string;
  scope: "full_archive" | "selected_tasks" | "owned_node_receipts";
  formatVersion: number;
  manifestBlobId: string;
  missingItems: readonly string[];
  unknownItems: readonly string[];
  exportedBy: string;
  exportedAt: string;
}
export function createArchiveExport(input: ArchiveExport): ArchiveExport {
  const value = object(input, "ArchiveExport");
  const scope = text(value.scope, "ArchiveExport.scope") as ArchiveExport["scope"];
  if (!["full_archive", "selected_tasks", "owned_node_receipts"].includes(scope))
    throw new TypeError(`Unsupported ArchiveExport.scope: ${scope}`);
  return Object.freeze({
    id: text(value.id, "ArchiveExport.id"),
    workspaceId: text(value.workspaceId, "ArchiveExport.workspaceId"),
    scope,
    formatVersion: integer(value.formatVersion, "ArchiveExport.formatVersion", 1),
    manifestBlobId: text(value.manifestBlobId, "ArchiveExport.manifestBlobId"),
    missingItems: Object.freeze(textArray(value.missingItems, "ArchiveExport.missingItems")),
    unknownItems: Object.freeze(textArray(value.unknownItems, "ArchiveExport.unknownItems")),
    exportedBy: text(value.exportedBy, "ArchiveExport.exportedBy"),
    exportedAt: timestamp(value.exportedAt, "ArchiveExport.exportedAt"),
  });
}
