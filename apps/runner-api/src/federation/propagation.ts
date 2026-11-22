export interface DataRights {
  readonly modelDisclose: boolean;
  readonly memberDisclose: boolean;
  readonly publicTimeline: boolean;
  readonly domainPropagate: boolean;
  readonly centralCache: boolean;
  readonly offlineRead: boolean;
}

export interface DerivedLabel {
  readonly rights: DataRights;
  readonly reviewVersion: number;
  readonly ownerReviewRequired: boolean;
}

const FIELDS: readonly (keyof DataRights)[] = [
  "modelDisclose",
  "memberDisclose",
  "publicTimeline",
  "domainPropagate",
  "centralCache",
  "offlineRead",
];

export function intersectDataRights(
  source: DataRights,
  recipient: DataRights,
  requested: DataRights,
  currentReviewVersion = 1,
): DerivedLabel {
  const rights: DataRights = {
    modelDisclose: source.modelDisclose && recipient.modelDisclose && requested.modelDisclose,
    memberDisclose: source.memberDisclose && recipient.memberDisclose && requested.memberDisclose,
    publicTimeline: source.publicTimeline && recipient.publicTimeline && requested.publicTimeline,
    domainPropagate:
      source.domainPropagate && recipient.domainPropagate && requested.domainPropagate,
    centralCache: source.centralCache && recipient.centralCache && requested.centralCache,
    offlineRead: source.offlineRead && recipient.offlineRead && requested.offlineRead,
  };
  const ownerReviewRequired = FIELDS.some((field) => source[field] && !rights[field]);
  return {
    rights,
    reviewVersion: currentReviewVersion + (ownerReviewRequired ? 1 : 0),
    ownerReviewRequired,
  };
}

export function assertModelEgressAllowed(rights: DataRights): void {
  if (!rights.modelDisclose) throw new Error("model_disclose_denied");
}

export function assertMemberTimelineAllowed(rights: DataRights): void {
  if (!rights.memberDisclose) throw new Error("member_disclose_denied");
}

export function assertPublicTimelineAllowed(rights: DataRights): void {
  if (!rights.publicTimeline) throw new Error("public_timeline_denied");
}

export function assertCentralCacheAllowed(rights: DataRights): void {
  if (!rights.centralCache) throw new Error("central_cache_denied");
}

export function assertOfflineReadAllowed(rights: DataRights): void {
  if (!rights.offlineRead) throw new Error("offline_read_denied");
}
