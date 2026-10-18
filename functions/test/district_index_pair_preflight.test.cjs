const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyDistrictIndexPair } = require("../lib/district_index_pair_preflight");

const base = {
  expectedCollection: "service_areas",
  expectedDocumentId: "area-1",
  expectedName: "Gaur City",
  legacyParentIds: ["country-1", "state-1", "city-1"],
  districtParentIds: ["country-1", "state-1", "district-1", "city-1"],
};
function index(parentIds, overrides = {}) {
  return {
    exists: true,
    collectionPath: "service_areas",
    documentId: "area-1",
    name: "gaur city",
    parentIds,
    ...overrides,
  };
}
const absent = { exists: false };

test("classifies both missing indexes as manual-review", () => {
  const r = classifyDistrictIndexPair({ ...base, legacy: absent, districtAware: absent });
  assert.equal(r.status, "MISSING_BOTH");
  assert.equal(r.safeToMigrate, false);
});

test("classifies consistent legacy-only index as migration candidate", () => {
  const r = classifyDistrictIndexPair({
    ...base, legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(r.status, "LEGACY_ONLY");
  assert.equal(r.safeToMigrate, true);
});

test("classifies consistent District-aware-only index as migration candidate", () => {
  const r = classifyDistrictIndexPair({
    ...base, legacy: absent, districtAware: index(base.districtParentIds),
  });
  assert.equal(r.status, "DISTRICT_ONLY");
  assert.equal(r.safeToMigrate, true);
});

test("classifies two consistent indexes owned by the same document", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    legacy: index(base.legacyParentIds),
    districtAware: index(base.districtParentIds),
  });
  assert.equal(r.status, "BOTH_SAME_DOCUMENT");
  assert.equal(r.safeToMigrate, true);
});

test("blocks indexes that point to different location documents", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    legacy: index(base.legacyParentIds),
    districtAware: index(base.districtParentIds, { documentId: "area-2" }),
  });
  assert.equal(r.status, "CONFLICT_DIFFERENT_DOCUMENT");
  assert.equal(r.safeToMigrate, false);
});

test("blocks a legacy index with a wrong parent tuple", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    legacy: index(["country-other", "state-1", "city-1"]),
    districtAware: absent,
  });
  assert.equal(r.status, "LEGACY_OWNER_MISMATCH");
  assert.equal(r.safeToMigrate, false);
});

test("blocks a District-aware index with a wrong collection or name", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    legacy: absent,
    districtAware: index(base.districtParentIds, { collectionPath: "service_localities" }),
  });
  assert.equal(r.status, "DISTRICT_OWNER_MISMATCH");
  assert.equal(r.safeToMigrate, false);
});

test("normalizes expected name but does not mutate index inputs", () => {
  const legacy = index(base.legacyParentIds, { name: "gaur city" });
  const before = JSON.stringify(legacy);
  const r = classifyDistrictIndexPair({
    ...base, expectedName: "  GAUR   CITY ", legacy, districtAware: absent,
  });
  assert.equal(r.status, "LEGACY_ONLY");
  assert.equal(JSON.stringify(legacy), before);
});
