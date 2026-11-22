import { integer, object, text, timestamp } from "./validation.js";

export const BLOB_OBJECT_STATES = ["available", "missing", "pending_reconciliation"] as const;
export type BlobObjectState = (typeof BLOB_OBJECT_STATES)[number];

export interface BlobObject {
  id: string;
  storageKey: string;
  sha256: string;
  size: number;
  mediaType: string;
  state: BlobObjectState;
  createdAt: string;
}

export function parseBlobObject(value: unknown): BlobObject {
  const input = object(value, "BlobObject");
  const state = text(input.state, "BlobObject.state") as BlobObjectState;
  if (!BLOB_OBJECT_STATES.includes(state))
    throw new TypeError(`Unsupported BlobObject.state: ${state}`);
  return {
    id: text(input.id, "BlobObject.id"),
    storageKey: text(input.storageKey, "BlobObject.storageKey"),
    sha256: text(input.sha256, "BlobObject.sha256"),
    size: integer(input.size, "BlobObject.size"),
    mediaType: text(input.mediaType, "BlobObject.mediaType"),
    state,
    createdAt: timestamp(input.createdAt, "BlobObject.createdAt"),
  };
}
