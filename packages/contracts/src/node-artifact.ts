import type { B1NodeArtifact } from "../../test-support/src/federation/tool-fixtures.js";
import { fedDigest, fedObject, fedStrings, fedText, fedTime } from "./federation-validation.js";

export type { B1NodeArtifact as NodeArtifact } from "../../test-support/src/federation/tool-fixtures.js";

export function parseNodeArtifact(value: unknown): B1NodeArtifact {
  const input = fedObject(value, "NodeArtifact");
  return Object.freeze({
    id: fedText(input.id, "NodeArtifact.id"),
    originNodeIds: fedStrings(input.originNodeIds, "NodeArtifact.originNodeIds"),
    originOwnerIds: fedStrings(input.originOwnerIds, "NodeArtifact.originOwnerIds"),
    originGrantDigests: (Array.isArray(input.originGrantDigests)
      ? input.originGrantDigests.map((entry) => fedDigest(entry, "NodeArtifact.originGrantDigests"))
      : (() => {
          throw new TypeError("NodeArtifact.originGrantDigests must be an array");
        })()) as B1NodeArtifact["originGrantDigests"],
    derivedFrom: fedStrings(input.derivedFrom, "NodeArtifact.derivedFrom"),
    contentDigest: fedDigest(
      input.contentDigest,
      "NodeArtifact.contentDigest",
    ) as B1NodeArtifact["contentDigest"],
    securityLabelId: fedText(input.securityLabelId, "NodeArtifact.securityLabelId"),
    createdAt: fedTime(input.createdAt, "NodeArtifact.createdAt"),
  });
}
