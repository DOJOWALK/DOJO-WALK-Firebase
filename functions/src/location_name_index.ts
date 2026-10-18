import { createHash } from "node:crypto";

export const SERVICE_LOCATION_COLLECTIONS = {
  country: "service_countries",
  state: "service_states",
  city: "service_cities",
  area: "service_areas",
  locality: "service_localities",
} as const;

export type ServiceLocationType = keyof typeof SERVICE_LOCATION_COLLECTIONS;

export function normalizeServiceLocationName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Must remain byte-for-byte compatible with the Admin Dart implementation:
 * sha256(utf8(jsonEncode([collectionPath, trimmedParentIds, normalizedName]))).
 */
export function serviceLocationNameIndexId(
  collectionPath: string,
  parentIds: readonly string[],
  name: string,
): string {
  if (!Object.values(SERVICE_LOCATION_COLLECTIONS).includes(collectionPath as never)) {
    throw new Error("LOCATION_INDEX_COLLECTION_INVALID");
  }
  const normalizedName = normalizeServiceLocationName(name);
  if (!normalizedName || normalizedName.length > 120) {
    throw new Error("LOCATION_INDEX_NAME_INVALID");
  }
  const normalizedParents = parentIds.map((id) => {
    if (typeof id !== "string") throw new Error("LOCATION_INDEX_PARENT_INVALID");
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 128) throw new Error("LOCATION_INDEX_PARENT_INVALID");
    return trimmed;
  });
  const expectedParentCount: Record<string, number> = {
    service_countries: 0,
    service_states: 1,
    service_cities: 2,
    service_areas: 3,
    service_localities: 4,
  };
  if (normalizedParents.length !== expectedParentCount[collectionPath]) {
    throw new Error("LOCATION_INDEX_PARENT_COUNT_INVALID");
  }
  const canonicalTuple = JSON.stringify([collectionPath, normalizedParents, normalizedName]);
  return createHash("sha256").update(Buffer.from(canonicalTuple, "utf8")).digest("hex");
}
