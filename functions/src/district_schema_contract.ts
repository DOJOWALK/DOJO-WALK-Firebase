/**
 * District-first schema contract helpers.
 *
 * These helpers are deliberately additive and are not wired into production
 * callables yet. The existing trusted callable contract remains unchanged until
 * legacy-compatible transactional ancestry validation and integration tests land.
 */
export const DISTRICT_SCHEMA_COLLECTIONS = {
  district: "service_districts",
  city: "service_cities",
  area: "service_areas",
} as const;

export interface DistrictParentChain {
  countryId: string;
  stateId: string;
  districtId: string;
  cityId?: string;
  areaId?: string;
}

const SAFE_LOCATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeDistrictParentChain(
  value: unknown,
  includeCity: boolean,
  includeArea = false,
): DistrictParentChain {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DISTRICT_CHAIN_INVALID");
  }
  const record = value as Record<string, unknown>;
  const expected = new Set([
    "countryId",
    "stateId",
    "districtId",
    ...(includeCity ? ["cityId"] : []),
    ...(includeArea ? ["areaId"] : []),
  ]);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) throw new Error("DISTRICT_CHAIN_FIELD_INVALID");
  }
  const normalized: Record<string, string> = {};
  for (const key of expected) {
    const item = record[key];
    if (typeof item !== "string" || !SAFE_LOCATION_ID.test(item.trim())) {
      throw new Error("DISTRICT_CHAIN_PARENT_INVALID");
    }
    normalized[key] = item.trim();
  }
  return normalized as unknown as DistrictParentChain;
}

/**
 * Compare canonical ancestry read from trusted parent documents.
 * Caller must fetch these documents from Firestore inside a transaction and
 * must separately enforce authorization, active status and immutable parents.
 */
export function districtParentChainIsConsistent(input: {
  district: { countryId?: unknown; stateId?: unknown };
  city?: { countryId?: unknown; stateId?: unknown; districtId?: unknown };
  area?: { countryId?: unknown; stateId?: unknown; districtId?: unknown; cityId?: unknown };
  expected: DistrictParentChain;
}): boolean {
  const { district, city, area, expected } = input;
  if (
    district.countryId !== expected.countryId ||
    district.stateId !== expected.stateId
  ) return false;

  if (city) {
    if (
      city.countryId !== expected.countryId ||
      city.stateId !== expected.stateId ||
      city.districtId !== expected.districtId ||
      !expected.cityId
    ) return false;
  }

  if (area) {
    if (
      !city ||
      area.countryId !== expected.countryId ||
      area.stateId !== expected.stateId ||
      area.districtId !== expected.districtId ||
      area.cityId !== expected.cityId ||
      !expected.areaId
    ) return false;
  }

  return true;
}
