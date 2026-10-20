const test = require("node:test");
const assert = require("node:assert/strict");
const { validateServiceLocationPayload } = require("../lib/location_name_index");

test("current Area payload contract rejects districtId until callable/index migration is atomic", () => {
  assert.throws(
    () => validateServiceLocationPayload("area", {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      cityId: "city-1",
      name: "Area One",
    }),
    /LOCATION_PAYLOAD_FIELD_INVALID/,
  );
});

test("City payload contract accepts an optional District parent", () => {
  assert.deepEqual(
    validateServiceLocationPayload("city", {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      name: "City One",
    }),
    {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      name: "City One",
    },
  );
});

test("legacy Area payload remains valid without districtId", () => {
  assert.deepEqual(
    validateServiceLocationPayload("area", {
      countryId: "country-1",
      stateId: "state-1",
      cityId: "city-1",
      name: "Area One",
    }),
    {
      countryId: "country-1",
      stateId: "state-1",
      cityId: "city-1",
      name: "Area One",
    },
  );
});
