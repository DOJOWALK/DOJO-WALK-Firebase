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

test("blocks dual indexes when both consistently point to a different location", () => {
  const legacy = index(base.legacyParentIds, { documentId: "area-other" });
  const districtAware = index(base.districtParentIds, { documentId: "area-other" });
  const r = classifyDistrictIndexPair({
    ...base, legacy, districtAware,
  });
  assert.equal(r.status, "LEGACY_OWNER_MISMATCH");
  assert.equal(r.safeToMigrate, false);
});

test("blocks District-aware-only index owned by another location", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    legacy: absent,
    districtAware: index(base.districtParentIds, { documentId: "area-other" }),
  });
  assert.equal(r.status, "DISTRICT_OWNER_MISMATCH");
  assert.equal(r.safeToMigrate, false);
});

test("rejects empty expected name and malformed parent tuples", () => {
  const emptyName = classifyDistrictIndexPair({
    ...base, expectedName: "   ", legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(emptyName.status, "INPUT_INVALID");
  assert.equal(emptyName.safeToMigrate, false);

  const malformedParents = classifyDistrictIndexPair({
    ...base, legacyParentIds: ["country-1", ""],
    legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(malformedParents.status, "INPUT_INVALID");
  assert.equal(malformedParents.safeToMigrate, false);
});

test("rejects oversized expected name and invalid expected document ID", () => {
  const longName = classifyDistrictIndexPair({
    ...base, expectedName: "x".repeat(121), legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(longName.status, "INPUT_INVALID");
  assert.equal(longName.safeToMigrate, false);

  const invalidId = classifyDistrictIndexPair({
    ...base, expectedDocumentId: "area/child",
    legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(invalidId.status, "INPUT_INVALID");
  assert.equal(invalidId.safeToMigrate, false);
});

test("rejects whitespace-padded parent IDs and collection paths", () => {
  const paddedParent = classifyDistrictIndexPair({
    ...base, legacyParentIds: [" country-1", "state-1", "city-1"],
    legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(paddedParent.status, "INPUT_INVALID");
  assert.equal(paddedParent.safeToMigrate, false);

  const invalidCollection = classifyDistrictIndexPair({
    ...base, expectedCollection: "service_areas/area-1",
    legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(invalidCollection.status, "INPUT_INVALID");
  assert.equal(invalidCollection.safeToMigrate, false);
});

test("rejects malformed index snapshot shapes without throwing", () => {
  const badLegacy = classifyDistrictIndexPair({
    ...base, legacy: { exists: "yes" }, districtAware: absent,
  });
  assert.equal(badLegacy.status, "INPUT_INVALID");
  assert.equal(badLegacy.safeToMigrate, false);

  const missingSnapshot = classifyDistrictIndexPair({
    ...base, legacy: null, districtAware: absent,
  });
  assert.equal(missingSnapshot.status, "INPUT_INVALID");
  assert.equal(missingSnapshot.safeToMigrate, false);
});

test("rejects duplicate IDs in either expected parent tuple", () => {
  const duplicateLegacy = classifyDistrictIndexPair({
    ...base, legacyParentIds: ["country-1", "state-1", "country-1"],
    legacy: index(base.legacyParentIds), districtAware: absent,
  });
  assert.equal(duplicateLegacy.status, "INPUT_INVALID");
  assert.equal(duplicateLegacy.safeToMigrate, false);

  const duplicateDistrict = classifyDistrictIndexPair({
    ...base, districtParentIds: ["country-1", "state-1", "district-1", "state-1"],
    legacy: absent, districtAware: index(base.districtParentIds),
  });
  assert.equal(duplicateDistrict.status, "INPUT_INVALID");
  assert.equal(duplicateDistrict.safeToMigrate, false);
});

test("rejects populated snapshots with malformed owner or name fields", () => {
  const badDocumentId = classifyDistrictIndexPair({
    ...base,
    legacy: index(base.legacyParentIds, { documentId: "area/1" }),
    districtAware: absent,
  });
  assert.equal(badDocumentId.status, "INPUT_INVALID");
  assert.equal(badDocumentId.safeToMigrate, false);

  const nonCanonicalName = classifyDistrictIndexPair({
    ...base,
    legacy: index(base.legacyParentIds, { name: "GAUR CITY" }),
    districtAware: absent,
  });
  assert.equal(nonCanonicalName.status, "INPUT_INVALID");
  assert.equal(nonCanonicalName.safeToMigrate, false);
});

test("parent tuple comparison is order-sensitive and exact", () => {
  const reordered = classifyDistrictIndexPair({
    ...base,
    legacy: index(["state-1", "country-1", "city-1"]),
    districtAware: absent,
  });
  assert.equal(reordered.status, "LEGACY_OWNER_MISMATCH");
  assert.equal(reordered.safeToMigrate, false);

  const differentLength = classifyDistrictIndexPair({
    ...base,
    legacy: index(["country-1", "state-1"]),
    districtAware: absent,
  });
  assert.equal(differentLength.status, "LEGACY_OWNER_MISMATCH");
  assert.equal(differentLength.safeToMigrate, false);
});

test("rejects null runtime preflight input without throwing", () => {
  const r = classifyDistrictIndexPair(null);
  assert.equal(r.status, "INPUT_INVALID");
  assert.equal(r.safeToMigrate, false);
});

test("rejects populated snapshot names with repeated internal whitespace", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    legacy: index(base.legacyParentIds, { name: "gaur   city" }),
    districtAware: absent,
  });
  assert.equal(r.status, "INPUT_INVALID");
  assert.equal(r.safeToMigrate, false);
});

test("rejects undefined and primitive runtime preflight inputs without throwing", () => {
  for (const input of [undefined, "invalid", 42, true]) {
    const r = classifyDistrictIndexPair(input);
    assert.equal(r.status, "INPUT_INVALID");
    assert.equal(r.safeToMigrate, false);
  }
});

test("rejects snapshot names with non-canonical whitespace variants", () => {
  for (const name of [" gaur city", "gaur city ", "gaur\tcity", "gaur\ncity", "gaur  city"]) {
    const r = classifyDistrictIndexPair({
      ...base,
      legacy: index(base.legacyParentIds, { name }),
      districtAware: absent,
    });
    assert.equal(r.status, "INPUT_INVALID", JSON.stringify({ name, result: r }));
    assert.equal(r.safeToMigrate, false);
  }
});

test("normalizes expected name whitespace before comparing canonical snapshots", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    expectedName: "  GAUR    CITY  ",
    legacy: index(base.legacyParentIds, { name: "gaur city" }),
    districtAware: absent,
  });
  assert.equal(r.status, "LEGACY_ONLY");
  assert.equal(r.safeToMigrate, true);
});

test("normalizes tabs and newlines in the expected name", () => {
  const r = classifyDistrictIndexPair({
    ...base,
    expectedName: "  GAUR\t \n CITY  ",
    legacy: index(base.legacyParentIds, { name: "gaur city" }),
    districtAware: absent,
  });
  assert.equal(r.status, "LEGACY_ONLY");
  assert.equal(r.safeToMigrate, true);
});

test("does not mutate either index snapshot during classification", () => {
  const legacy = index(base.legacyParentIds);
  const districtAware = index(base.districtParentIds);
  const beforeLegacy = JSON.stringify(legacy);
  const beforeDistrictAware = JSON.stringify(districtAware);

  const r = classifyDistrictIndexPair({
    ...base, legacy, districtAware,
  });

  assert.equal(r.status, "BOTH_SAME_DOCUMENT");
  assert.equal(r.safeToMigrate, true);
  assert.equal(JSON.stringify(legacy), beforeLegacy);
  assert.equal(JSON.stringify(districtAware), beforeDistrictAware);
});
