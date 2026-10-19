const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveDistrictAwareParentIdsFromTrustedDocuments: derive } =
  require("../lib/district_ancestry_parent_tuple");

function ancestry({ district = true, area = true } = {}) {
  const value = {
    country: { id: "country-1", data: { name: "India" } },
    state: { id: "state-1", data: { countryId: "country-1" } },
    city: { id: "city-1", data: { countryId: "country-1", stateId: "state-1" } },
  };
  if (district) {
    value.district = {
      id: "district-1",
      data: { countryId: "country-1", stateId: "state-1" },
    };
    value.city.data.districtId = "district-1";
  }
  if (area) {
    value.area = {
      id: "area-1",
      data: { countryId: "country-1", stateId: "state-1", cityId: "city-1" },
    };
  }
  return value;
}

test("derives City tuple only when a trusted District document is present", () => {
  assert.deepEqual(derive("city", ancestry()), ["country-1", "state-1", "district-1"]);
  assert.equal(derive("city", ancestry({ district: false })), null);
});

test("derives Area tuple from trusted City and District ancestry", () => {
  assert.deepEqual(derive("area", ancestry()), [
    "country-1", "state-1", "district-1", "city-1",
  ]);
});

test("derives Locality tuple from trusted City, District, and Area ancestry", () => {
  assert.deepEqual(derive("locality", ancestry()), [
    "country-1", "state-1", "district-1", "city-1", "area-1",
  ]);
});

test("legacy City without District returns null instead of inventing a District tuple", () => {
  assert.equal(derive("area", ancestry({ district: false })), null);
  assert.equal(derive("locality", ancestry({ district: false })), null);
});

test("rejects a District that belongs to another State", () => {
  const f = ancestry();
  f.district.data.stateId = "state-other";
  assert.throws(() => derive("area", f), /DISTRICT_INDEX_ANCESTRY_MISMATCH/);
});

test("rejects a City whose District link and trusted District document disagree", () => {
  const f = ancestry();
  f.city.data.districtId = "district-other";
  assert.throws(() => derive("area", f), /DISTRICT_INDEX_ANCESTRY_MISMATCH/);
});

test("rejects an Area belonging to another City when deriving Locality tuple", () => {
  const f = ancestry();
  f.area.data.cityId = "city-other";
  assert.throws(() => derive("locality", f), /DISTRICT_INDEX_ANCESTRY_MISMATCH/);
});

test("rejects missing or malformed trusted document IDs", () => {
  const f = ancestry();
  f.city.id = "city/invalid";
  assert.throws(() => derive("area", f), /DISTRICT_INDEX_PARENT_INVALID/);
});
