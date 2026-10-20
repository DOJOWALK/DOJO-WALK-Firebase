const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  serviceLocationNameIndexId,
} = require("../lib/location_name_index");
const {
  districtAwareNameIndexId,
} = require("../lib/district_name_index_contract");
const {
  classifyAreaMigrationPreflight,
  classifyCityDistrictCompatibility,
  districtParentChainIsConsistent,
} = require("../lib/district_schema_contract");

test("Locality legacy and District-aware index IDs are different and deterministic", () => {
  const legacy = serviceLocationNameIndexId(
    "service_localities",
    ["country-1", "state-1", "city-1", "area-1"],
    "Gaur City",
  );
  const proposed = districtAwareNameIndexId("locality", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
    areaId: "area-1",
  }, "Gaur City");
  assert.match(legacy, /^[a-f0-9]{64}$/);
  assert.match(proposed, /^[a-f0-9]{64}$/);
  assert.notEqual(legacy, proposed);
  assert.equal(proposed, districtAwareNameIndexId("locality", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
    areaId: "area-1",
  }, "Gaur City"));
});

test("Locality preflight recognizes a trusted District-linked City", () => {
  assert.equal(classifyCityDistrictCompatibility({
    city: { countryId: "country-1", stateId: "state-1", districtId: "district-1" },
    district: { countryId: "country-1", stateId: "state-1" },
    expectedCountryId: "country-1",
    expectedStateId: "state-1",
  }), "DISTRICT_LINKED");
});

test("Locality preflight treats missing legacy index as not ready", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: false,
    proposedIndexOwnerId: null,
    areaId: "locality-1",
  }), "LEGACY_INDEX_MISSING_OR_MISMATCHED");
});

test("Locality preflight detects an index occupied by another Locality", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: true,
    proposedIndexOwnerId: "locality-other",
    areaId: "locality-1",
  }), "INDEX_CONFLICT");
});

test("Locality parent-chain contract rejects mismatched Area ancestry", () => {
  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city: { countryId: "country-1", stateId: "state-1", districtId: "district-1" },
    area: { countryId: "country-1", stateId: "state-1", districtId: "district-1", cityId: "city-1" },
    locality: { countryId: "country-1", stateId: "state-1", districtId: "district-1", cityId: "city-1", areaId: "area-other" },
    expected: { countryId: "country-1", stateId: "state-1", districtId: "district-1", cityId: "city-1", areaId: "area-1" },
  }), false);
});

test("Locality preflight scanner is read-only and paginated", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/district_locality_migration_preflight.cjs"), "utf8");
  assert.match(source, /collection\("service_localities"\)\.orderBy\("__name__"\)\.limit\(pageSize\)/);
  assert.match(source, /startAfter\(cursor\)/);
  assert.match(source, /districtAwareNameIndexId\("locality"/);
  assert.match(source, /service_location_name_indexes/);
  assert.doesNotMatch(source, /\.set\(|\.create\(|\.update\(|\.delete\(/);
});
