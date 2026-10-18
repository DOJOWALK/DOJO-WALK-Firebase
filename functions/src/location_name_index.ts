import { createHash } from "node:crypto";

export const SERVICE_LOCATION_COLLECTIONS = {
  country: "service_countries",
  state: "service_states",
  district: "service_districts",
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
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) throw new Error("LOCATION_INDEX_PARENT_INVALID");
    return trimmed;
  });
  const expectedParentCount: Record<string, number | number[]> = {
    service_countries: 0,
    service_states: 1,
    service_districts: 2,
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

export const SERVICE_LOCATION_ALLOWED_FIELDS: Record<ServiceLocationType, readonly string[]> = {
  country: ["name", "code", "isActive"],
  state: ["countryId", "name", "isActive"],
  district: ["countryId", "stateId", "name", "isServiceActive"],
  city: ["countryId", "stateId", "name", "boundary", "boundarySource", "boundaryVerified", "verifiedBoundaryId", "isServiceActive"],
  area: ["countryId", "stateId", "cityId", "name", "boundary", "boundarySource", "boundaryVerified", "verifiedBoundaryId", "isServiceActive"],
  locality: ["countryId", "stateId", "cityId", "areaId", "name", "pincode", "boundary", "boundarySource", "boundaryVerified", "isServiceActive"],
};

/**
 * Validate a callable's proposed payload before any Firestore reads/writes.
 * This is a schema guard only; the callable must still verify ancestry,
 * authorization, immutable parents, boundary rules, and uniqueness in a transaction.
 */
export function validateServiceLocationPayload(
  type: ServiceLocationType,
  payload: unknown,
): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("LOCATION_PAYLOAD_INVALID");
  }
  const record = payload as Record<string, unknown>;
  const allowed = new Set(SERVICE_LOCATION_ALLOWED_FIELDS[type]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error("LOCATION_PAYLOAD_FIELD_INVALID");
  }
  if (typeof record.name !== "string") throw new Error("LOCATION_INDEX_NAME_INVALID");
  const name = record.name.trim();
  if (!name || name.length > 120) throw new Error("LOCATION_INDEX_NAME_INVALID");
  if (type === "country") {
    if (typeof record.code !== "string" || !record.code.trim() || record.code.trim().length > 16) {
      throw new Error("LOCATION_PAYLOAD_CODE_INVALID");
    }
  }
  const parentFields: Record<ServiceLocationType, readonly string[]> = {
    country: [],
    state: ["countryId"],
    district: ["countryId", "stateId"],
    city: ["countryId", "stateId"],
    area: ["countryId", "stateId", "cityId"],
    locality: ["countryId", "stateId", "cityId", "areaId"],
  };
  const normalizedRecord: Record<string, unknown> = { ...record, name };
  if (type === "country") normalizedRecord.code = (record.code as string).trim();
  for (const field of parentFields[type]) {
    const value = record[field];
    if (typeof value !== "string") {
      throw new Error("LOCATION_INDEX_PARENT_INVALID");
    }
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) {
      throw new Error("LOCATION_INDEX_PARENT_INVALID");
    }
    // Store exactly the parent ID used to build the canonical name index.
    normalizedRecord[field] = trimmed;
  }
  return normalizedRecord;
}
