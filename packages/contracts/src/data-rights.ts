import { boolean, object } from "../../domain/src/validation.js";

export const DATA_RIGHT_KEYS = [
  "modelDisclose",
  "memberDisclose",
  "publicTimeline",
  "domainPropagate",
  "centralCache",
  "offlineRead",
] as const;

export type DataRightKey = (typeof DATA_RIGHT_KEYS)[number];

/**
 * Independent data-flow rights. A right is never inferred from a sensitivity
 * level, membership, or another right.
 */
export interface DataRights {
  modelDisclose: boolean;
  memberDisclose: boolean;
  publicTimeline: boolean;
  domainPropagate: boolean;
  centralCache: boolean;
  offlineRead: boolean;
}

/** Federated Beta is opt-in; every right is denied until explicitly granted. */
export const DEFAULT_DATA_RIGHTS: Readonly<DataRights> = Object.freeze({
  modelDisclose: false,
  memberDisclose: false,
  publicTimeline: false,
  domainPropagate: false,
  centralCache: false,
  offlineRead: false,
});

function defaultOff(value: unknown, name: string): boolean {
  if (value === undefined || value === null) return false;
  return boolean(value, name);
}

/**
 * Parses the complete rights value object. Omitted rights are denied rather
 * than inferred. Present values must be booleans.
 */
export function parseDataRights(value: unknown): DataRights {
  const input = object(value, "DataRights");
  return {
    modelDisclose: defaultOff(input.modelDisclose, "DataRights.modelDisclose"),
    memberDisclose: defaultOff(input.memberDisclose, "DataRights.memberDisclose"),
    publicTimeline: defaultOff(input.publicTimeline, "DataRights.publicTimeline"),
    domainPropagate: defaultOff(input.domainPropagate, "DataRights.domainPropagate"),
    centralCache: defaultOff(input.centralCache, "DataRights.centralCache"),
    offlineRead: defaultOff(input.offlineRead, "DataRights.offlineRead"),
  };
}

/** Builds a rights value with Beta-safe default-off semantics. */
export function createDataRights(overrides: Partial<DataRights> = {}): DataRights {
  return parseDataRights(overrides);
}

export function isDataRightEnabled(rights: DataRights, right: DataRightKey): boolean {
  return rights[right];
}

/**
 * Applies an owner-approved reduction. A right may only move from true to
 * false; requesting a new right throws instead of widening the Grant.
 */
export function reduceDataRights(current: DataRights, requested: Partial<DataRights>): DataRights {
  const result = parseDataRights(current);
  const reduction = object(requested, "DataRights.reduction");

  for (const key of DATA_RIGHT_KEYS) {
    const value = reduction[key];
    if (value === undefined) continue;

    const narrowed = boolean(value, `DataRights.reduction.${key}`);
    if (narrowed && !result[key]) {
      throw new TypeError(`DataRights.${key} cannot be expanded by a reduction`);
    }
    result[key] = narrowed;
  }

  return result;
}

/** Ensures a replacement value did not enable any previously denied right. */
export function assertDataRightsNotExpanded(previous: DataRights, next: DataRights): void {
  const before = parseDataRights(previous);
  const after = parseDataRights(next);

  for (const key of DATA_RIGHT_KEYS) {
    if (after[key] && !before[key]) {
      throw new TypeError(`DataRights.${key} cannot be expanded`);
    }
  }
}
