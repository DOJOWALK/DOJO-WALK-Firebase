export type DistrictIndexPairStatus =
  | "MISSING_BOTH"
  | "LEGACY_ONLY"
  | "DISTRICT_ONLY"
  | "BOTH_SAME_DOCUMENT"
  | "CONFLICT_DIFFERENT_DOCUMENT"
  | "LEGACY_OWNER_MISMATCH"
  | "DISTRICT_OWNER_MISMATCH";

export interface NameIndexSnapshot {
  exists: boolean;
  documentId?: unknown;
  collectionPath?: unknown;
  parentIds?: unknown;
  name?: unknown;
}

export interface DistrictIndexPairClassification {
  status: DistrictIndexPairStatus;
  safeToMigrate: boolean;
  reason: string;
}

/**
 * Read-only classification for the two canonical index documents for one
 * location. This function never mutates Firestore and is deliberately
 * separate from the production save callable.
 */
export function classifyDistrictIndexPair(input: {
  expectedCollection: string;
  expectedDocumentId: string;
  expectedName: string;
  legacyParentIds: readonly string[];
  districtParentIds: readonly string[];
  legacy: NameIndexSnapshot;
  districtAware: NameIndexSnapshot;
}): DistrictIndexPairClassification {
  const { legacy, districtAware } = input;
  const ownerMatches = (index: NameIndexSnapshot, parents: readonly string[]) =>
    index.exists &&
    index.documentId === input.expectedDocumentId &&
    index.collectionPath === input.expectedCollection &&
    index.name === input.expectedName.trim().toLowerCase().replace(/\s+/g, " ") &&
    Array.isArray(index.parentIds) &&
    JSON.stringify(index.parentIds) === JSON.stringify(parents);

  if (legacy.exists && !ownerMatches(legacy, input.legacyParentIds)) {
    return { status: "LEGACY_OWNER_MISMATCH", safeToMigrate: false, reason: "Legacy index does not match the expected document, collection, name, or parent tuple." };
  }
  if (districtAware.exists && !ownerMatches(districtAware, input.districtParentIds)) {
    return { status: "DISTRICT_OWNER_MISMATCH", safeToMigrate: false, reason: "District-aware index does not match the expected document, collection, name, or parent tuple." };
  }
  if (!legacy.exists && !districtAware.exists) {
    return { status: "MISSING_BOTH", safeToMigrate: false, reason: "Neither canonical index exists; investigate before migration." };
  }
  if (legacy.exists && !districtAware.exists) {
    return { status: "LEGACY_ONLY", safeToMigrate: true, reason: "Legacy index is consistent and the District-aware index is absent." };
  }
  if (!legacy.exists && districtAware.exists) {
    return { status: "DISTRICT_ONLY", safeToMigrate: true, reason: "District-aware index is consistent and the legacy index is absent." };
  }
  if (legacy.documentId !== districtAware.documentId) {
    return { status: "CONFLICT_DIFFERENT_DOCUMENT", safeToMigrate: false, reason: "The two index documents point to different location documents." };
  }
  return { status: "BOTH_SAME_DOCUMENT", safeToMigrate: true, reason: "Both indexes consistently point to the same location document." };
}
