const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDistrictParentChain,
  districtParentChainIsConsistent,
  classifyCityDistrictCompatibility,
  classifyAreaMigrationPreflight,
} = require("../lib/district_schema_contract");

test("normalizes and accepts a valid District parent chain", () => {
  assert.deepEqual(
    normalizeDistrictParentChain({
      countryId: " country-1 ",
      stateId: " state-1 ",
      districtId: " district-1 ",
    }, false),
    { countryId: "country-1", stateId: "state-1", districtId: "district-1" },
  );
});

test("rejects unsafe parent IDs", () => {
  assert.throws(
    () => normalizeDistrictParentChain({
      countryId: "country/child",
      stateId: "state-1",
      districtId: "district-1",
    }, false),
    /DISTRICT_CHAIN_PARENT_INVALID/,
  );
});

test("rejects unexpected client-controlled fields", () => {
  assert.throws(
    () => normalizeDistrictParentChain({
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      isServiceActive: true,
    }, false),
    /DISTRICT_CHAIN_FIELD_INVALID/,
  );
});

test("rejects a city attached to a different District", () => {
  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-other",
    },
    expected: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
    },
  }), false);
});

test("accepts a consistent District → City → Area ancestry", () => {
  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    area: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
    },
    expected: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-1",
    },
  }), true);
});

test("rejects inconsistent Area ancestry", () => {
  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    area: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-other",
      cityId: "city-1",
    },
    expected: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-1",
    },
  }), false);
});

test("rejects an Area attached to a different City even when District matches", () => {
  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    area: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-other",
    },
    expected: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-1",
    },
  }), false);
});

test("rejects an Area whose Country or State differs from the trusted chain", () => {
  const expected = {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
    areaId: "area-1",
  };
  const city = {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
  };

  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city,
    area: {
      countryId: "country-other",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
    },
    expected,
  }), false);

  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city,
    area: {
      countryId: "country-1",
      stateId: "state-other",
      districtId: "district-1",
      cityId: "city-1",
    },
    expected,
  }), false);
});

test("accepts a consistent District → City → Area → Locality ancestry", () => {
  assert.equal(districtParentChainIsConsistent({
    district: { countryId: "country-1", stateId: "state-1" },
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    area: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
    },
    locality: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-1",
    },
    expected: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-1",
    },
  }), true);
});

test("rejects a Locality linked to a different Area or District", () => {
  const base = {
    district: { countryId: "country-1", stateId: "state-1" },
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    area: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
    },
    expected: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-1",
    },
  };

  assert.equal(districtParentChainIsConsistent({
    ...base,
    locality: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      areaId: "area-other",
    },
  }), false);

  assert.equal(districtParentChainIsConsistent({
    ...base,
    locality: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-other",
      cityId: "city-1",
      areaId: "area-1",
    },
  }), false);
});

test("classifies a legacy City without District without guessing a mapping", () => {
  assert.equal(classifyCityDistrictCompatibility({
    city: { countryId: "country-1", stateId: "state-1" },
    district: null,
    expectedCountryId: "country-1",
    expectedStateId: "state-1",
  }), "LEGACY_NO_DISTRICT");
});

test("classifies a City with a matching trusted District", () => {
  assert.equal(classifyCityDistrictCompatibility({
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    district: { countryId: "country-1", stateId: "state-1" },
    expectedCountryId: "country-1",
    expectedStateId: "state-1",
  }), "DISTRICT_LINKED");
});

test("classifies mismatched or missing District ancestry as broken", () => {
  assert.equal(classifyCityDistrictCompatibility({
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    district: { countryId: "country-other", stateId: "state-1" },
    expectedCountryId: "country-1",
    expectedStateId: "state-1",
  }), "BROKEN_PARENT_CHAIN");

  assert.equal(classifyCityDistrictCompatibility({
    city: {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
    },
    district: null,
    expectedCountryId: "country-1",
    expectedStateId: "state-1",
  }), "BROKEN_PARENT_CHAIN");
});

test("preflight classifies a clean Area with an unoccupied proposed index as READY", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: true,
    proposedIndexOwnerId: null,
    areaId: "area-1",
  }), "READY");
});

test("preflight preserves legacy and broken-parent exception categories", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "LEGACY_NO_DISTRICT",
    legacyIndexMatches: true,
    proposedIndexOwnerId: null,
    areaId: "area-1",
  }), "LEGACY_NO_DISTRICT");

  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "BROKEN_PARENT_CHAIN",
    legacyIndexMatches: true,
    proposedIndexOwnerId: null,
    areaId: "area-1",
  }), "BROKEN_PARENT_CHAIN");
});

test("preflight refuses mismatched legacy index and conflicting proposed index owner", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: false,
    proposedIndexOwnerId: null,
    areaId: "area-1",
  }), "LEGACY_INDEX_MISSING_OR_MISMATCHED");

  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: true,
    proposedIndexOwnerId: "area-other",
    areaId: "area-1",
  }), "INDEX_CONFLICT");
});

test("preflight allows an existing proposed index owned by the same Area", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: true,
    proposedIndexOwnerId: "area-1",
    areaId: "area-1",
  }), "READY");
});
