# Federated Beta support matrix

| Level | Snapshot reads | Fixed tools | Patch | Cross-domain artifacts | Default |
|---|---|---|---|---|---|
| `disabled` | No | No | No | No | Default for every install |
| `snapshot` | Yes, explicit manifests and Grants | No | No | No | Closed read-only Beta (B0) |
| `snapshot_tools` | Yes | Fixed, schema-bound templates only | No | No | B1 fixed-tool gate |
| `snapshot_tools_patch` | Yes | Fixed templates only | Independent local application only | Dual owner approval only | B1 complete gate |

## Security boundary

- Nodes make outbound mTLS connections only; no inbound listener is required or supported.
- Snapshot inclusion and `pathVisibility` are independent. Sealed copies are authoritative after a live file changes.
- Grants and data rights only narrow. Local expiry, revocation, budget exhaustion, and quarantine win over remote claims.
- Fixed tools never accept a shell, arbitrary executable, host environment, or default network access.
- Patch application requires an independent Grant and matching base digests; conflicts never auto-merge or write back.
- Unknown outcomes never automatically replay. Revoked, invalid, unavailable, and contradictory results remain visible with restricted payload.
- Emergency disable immediately returns every level to `disabled` without changing Stable behavior.

## Feedback and incident response

Use the desktop **Send feedback** action for non-secret issue reports. **Emergency-disable all federation** is the supported immediate containment action. Do not include credentials, private content, or production paths in feedback.
