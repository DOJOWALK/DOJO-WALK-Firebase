export type LegacyCityMappingStatus =
  | "already_linked"
  | "unique_evidence_candidate"
  | "ambiguous"
  | "no_candidate"
  | "parent_mismatch"
  | "invalid_record";

export interface InventoryCity {
  id: string;
  name?: unknown;
  countryId?: unknown;
  stateId?: unknown;
  districtId?: unknown;
}

export interface InventoryDistrict {
  id: string;
  countryId?: unknown;
  stateId?: unknown;
  name?: unknown;
}

export interface LegacyCityInventoryRow {
  cityId: string;
  cityName: string | null;
  status: LegacyCityMappingStatus;
  currentDistrictId: string | null;
  candidateDistrictIds: string[];
  reason: string;
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,150}$/.test(value);

const nonEmptyId = (value: unknown): value is string =>
  validId(value) && value.length > 0;

/**
 * Read-only classification for City → District mapping review.
 *
 * evidenceCandidates must come from an explicitly supplied authoritative
 * source keyed by City document ID. City/District names are never used to
 * infer a mapping. This module performs no I/O and mutates no input.
 */
export function buildLegacyCityDistrictInventory(input: {
  cities: readonly InventoryCity[];
  districts: readonly InventoryDistrict[];
  evidenceCandidates: Readonly<Record<string, readonly string[]>>;
}): LegacyCityInventoryRow[] {
  if (!input || !Array.isArray(input.cities) || !Array.isArray(input.districts) ||
      !input.evidenceCandidates || typeof input.evidenceCandidates !== "object") {
    throw new TypeError("Cities, districts, and an evidence-candidate map are required.");
  }

  const districtById = new Map<string, InventoryDistrict>();
  for (const district of input.districts) {
    if (district && validId(district.id) && !districtById.has(district.id)) {
      districtById.set(district.id, district);
    }
  }

  return input.cities.map((city): LegacyCityInventoryRow => {
    const cityId = city && validId(city.id) ? city.id : "INVALID_CITY_ID";
    const cityName = typeof city?.name === "string" ? city.name : null;
    const rawDistrictId = city?.districtId;
    const currentDistrictId = nonEmptyId(rawDistrictId) ? rawDistrictId : null;
    const parentIdsValid = nonEmptyId(city?.countryId) && nonEmptyId(city?.stateId);

    if (!city || !validId(city.id) || !parentIdsValid) {
      return {
        cityId,
        cityName,
        status: "invalid_record",
        currentDistrictId,
        candidateDistrictIds: [],
        reason: "City ID, countryId, or stateId is missing or malformed.",
      };
    }

    if (currentDistrictId) {
      const district = districtById.get(currentDistrictId);
      if (!district || district.countryId !== city.countryId || district.stateId !== city.stateId) {
        return {
          cityId,
          cityName,
          status: "parent_mismatch",
          currentDistrictId,
          candidateDistrictIds: [],
          reason: "Existing districtId is missing or its country/state parent does not match the City.",
        };
      }
      return {
        cityId,
        cityName,
        status: "already_linked",
        currentDistrictId,
        candidateDistrictIds: [currentDistrictId],
        reason: "Existing District link resolves and matches the City country/state.",
      };
    }

    const rawCandidates = input.evidenceCandidates[city.id] ?? [];
    const candidateDistrictIds = [...new Set(
      rawCandidates.filter((id): id is string => validId(id)),
    )].sort();

    if (candidateDistrictIds.length === 0) {
      return {
        cityId, cityName, status: "no_candidate", currentDistrictId: null,
        candidateDistrictIds: [],
        reason: "No explicit authoritative evidence candidate was supplied; names are not used for inference.",
      };
    }

    const candidateDistricts = candidateDistrictIds.map((id) => districtById.get(id));
    if (candidateDistricts.some((district) =>
      !district || district.countryId !== city.countryId || district.stateId !== city.stateId)) {
      return {
        cityId, cityName, status: "parent_mismatch", currentDistrictId: null,
        candidateDistrictIds,
        reason: "At least one evidence candidate is missing or has a different country/state parent.",
      };
    }

    if (candidateDistrictIds.length > 1) {
      return {
        cityId, cityName, status: "ambiguous", currentDistrictId: null,
        candidateDistrictIds,
        reason: "Multiple authoritative candidates require human review; no District was selected.",
      };
    }

    return {
      cityId, cityName, status: "unique_evidence_candidate", currentDistrictId: null,
      candidateDistrictIds,
      reason: "One parent-consistent evidence candidate exists; this is a proposal only, not an approved mapping.",
    };
  });
}
