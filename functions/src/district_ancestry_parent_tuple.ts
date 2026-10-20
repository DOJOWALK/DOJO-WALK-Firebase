import type { DistrictIndexedType } from "./district_name_index_contract";

export interface TrustedLocationDocument {
  id: unknown;
  data: Record<string, unknown>;
}

export interface TrustedDistrictAncestry {
  country: TrustedLocationDocument;
  state: TrustedLocationDocument;
  district?: TrustedLocationDocument | null;
  city?: TrustedLocationDocument | null;
  area?: TrustedLocationDocument | null;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function requireId(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !SAFE_ID.test(value)) {
    throw new Error("DISTRICT_INDEX_PARENT_INVALID");
  }
  return value;
}

function requireParentField(
  document: TrustedLocationDocument,
  field: string,
  expected: string,
): void {
  if (document.data[field] !== expected) {
    throw new Error("DISTRICT_INDEX_ANCESTRY_MISMATCH");
  }
}

/**
 * Derive District-aware tuples only from trusted, already-read Firestore
 * documents. Returns null for legacy City ancestry without districtId; callers
 * must preserve the legacy index and must not invent a District parent.
 *
 * This helper is intentionally not wired into production writes until the
 * coordinated dual-index transaction and migration are approved.
 */
export function deriveDistrictAwareParentIdsFromTrustedDocuments(
  type: Extract<DistrictIndexedType, "city" | "area" | "locality">,
  ancestry: TrustedDistrictAncestry,
): string[] | null {
  const countryId = requireId(ancestry.country.id);
  const stateId = requireId(ancestry.state.id);
  requireParentField(ancestry.state, "countryId", countryId);

  if (type === "city") {
    if (ancestry.district == null) return null;
    const districtId = requireId(ancestry.district.id);
    requireParentField(ancestry.district, "countryId", countryId);
    requireParentField(ancestry.district, "stateId", stateId);
    return [countryId, stateId, districtId];
  }

  if (ancestry.city == null) {
    throw new Error("DISTRICT_INDEX_ANCESTRY_MISMATCH");
  }
  const cityId = requireId(ancestry.city.id);
  requireParentField(ancestry.city, "countryId", countryId);
  requireParentField(ancestry.city, "stateId", stateId);

  const rawDistrictId = ancestry.city.data.districtId;
  if (rawDistrictId === undefined || rawDistrictId === null || rawDistrictId === "") {
    if (type === "area") return null;
    if (ancestry.area == null) {
      throw new Error("DISTRICT_INDEX_ANCESTRY_MISMATCH");
    }
    const areaId = requireId(ancestry.area.id);
    requireParentField(ancestry.area, "countryId", countryId);
    requireParentField(ancestry.area, "stateId", stateId);
    requireParentField(ancestry.area, "cityId", cityId);
    return null;
  }

  const districtId = requireId(rawDistrictId);
  if (ancestry.district == null || requireId(ancestry.district.id) !== districtId) {
    throw new Error("DISTRICT_INDEX_ANCESTRY_MISMATCH");
  }
  requireParentField(ancestry.district, "countryId", countryId);
  requireParentField(ancestry.district, "stateId", stateId);

  if (type === "area") {
    return [countryId, stateId, districtId, cityId];
  }

  if (ancestry.area == null) {
    throw new Error("DISTRICT_INDEX_ANCESTRY_MISMATCH");
  }
  const areaId = requireId(ancestry.area.id);
  requireParentField(ancestry.area, "countryId", countryId);
  requireParentField(ancestry.area, "stateId", stateId);
  requireParentField(ancestry.area, "cityId", cityId);
  return [countryId, stateId, districtId, cityId, areaId];
}
