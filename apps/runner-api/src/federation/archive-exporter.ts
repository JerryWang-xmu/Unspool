export interface FederationArchiveSupplement {
  readonly nodes: readonly Record<string, unknown>[];
  readonly snapshots: readonly Record<string, unknown>[];
  readonly grants: readonly Record<string, unknown>[];
  readonly operations: readonly Record<string, unknown>[];
  readonly propagationChains: readonly Record<string, unknown>[];
}

export function exportFederatedArchive(
  base: Record<string, unknown>,
  supplement: FederationArchiveSupplement,
) {
  return {
    ...base,
    federation: {
      nodes: supplement.nodes,
      snapshots: supplement.snapshots,
      grants: supplement.grants,
      executionVersions: supplement.operations,
      propagationChains: supplement.propagationChains,
    },
  };
}

export function serializeFederatedArchive(manifest: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}
