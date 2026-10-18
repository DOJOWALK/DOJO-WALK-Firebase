const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  districtAwareParentIds,
  districtAwareNameIndexId,
} = require("../lib/district_name_index_contract");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");

test("district-aware District index uses Country and State parents", () => {
  assert.deepEqual(districtAwareParentIds("district", {
    countryId: "country-1",
    stateId: "state-1",
  }), ["country-1", "state-1"]);
});

test("district-aware City index includes District in ordered parent tuple", () => {
  assert.deepEqual(districtAwareParentIds("city", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
  }), ["country-1", "state-1", "district-1"]);
});

test("district-aware Area and Locality include full ancestry", () => {
  assert.deepEqual(districtAwareParentIds("area", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
  }), ["country-1", "state-1", "district-1", "city-1"]);
  assert.deepEqual(districtAwareParentIds("locality", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
    areaId: "area-1",
  }), ["country-1", "state-1", "district-1", "city-1", "area-1"]);
});

test("rejects incomplete or unsafe district-aware parent chains", () => {
  assert.throws(() => districtAwareParentIds("city", {
    countryId: "country-1",
    stateId: "state-1",
  }), /DISTRICT_INDEX_PARENT_INVALID/);
  assert.throws(() => districtAwareParentIds("district", {
    countryId: "country/child",
    stateId: "state-1",
  }), /DISTRICT_INDEX_PARENT_INVALID/);
});

test("district-aware index follows canonical JSON SHA-256 tuple format", () => {
  const tuple = JSON.stringify([
    "service_cities",
    ["country-1", "state-1", "district-1"],
    "noida",
  ]);
  const expected = createHash("sha256").update(Buffer.from(tuple, "utf8")).digest("hex");
  assert.equal(districtAwareNameIndexId("city", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
  }, " Noida "), expected);
});

test("legacy city index generation keeps the two-parent tuple format", () => {
  const tuple = JSON.stringify([
    "service_cities",
    ["country-1", "state-1"],
    "noida",
  ]);
  const expected = createHash("sha256").update(Buffer.from(tuple, "utf8")).digest("hex");
  assert.equal(
    serviceLocationNameIndexId("service_cities", ["country-1", "state-1"], " Noida "),
    expected,
  );
});

test("legacy and District-aware Area indexes remain distinct during migration", () => {
  const legacyId = serviceLocationNameIndexId(
    "service_areas",
    ["country-1", "state-1", "city-1"],
    "gaur city",
  );
  const districtAwareId = districtAwareNameIndexId("area", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
  }, "Gaur City");

  assert.match(legacyId, /^[a-f0-9]{64}$/);
  assert.match(districtAwareId, /^[a-f0-9]{64}$/);
  assert.notEqual(legacyId, districtAwareId);
});

test("legacy and District-aware Locality indexes remain distinct during migration", () => {
  const legacyId = serviceLocationNameIndexId(
    "service_localities",
    ["country-1", "state-1", "city-1", "area-1"],
    "techzone four",
  );
  const districtAwareId = districtAwareNameIndexId("locality", {
    countryId: "country-1",
    stateId: "state-1",
    districtId: "district-1",
    cityId: "city-1",
    areaId: "area-1",
  }, "Techzone Four");

  assert.match(legacyId, /^[a-f0-9]{64}$/);
  assert.match(districtAwareId, /^[a-f0-9]{64}$/);
  assert.notEqual(legacyId, districtAwareId);
});
