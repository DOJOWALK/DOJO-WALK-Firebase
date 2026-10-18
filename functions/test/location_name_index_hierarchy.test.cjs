const test = require("node:test");
const assert = require("node:assert/strict");
const {
  serviceLocationNameIndexId,
} = require("../lib/location_name_index");

test("all five hierarchy types accept their exact parent count", () => {
  const cases = [
    ["service_countries", [], "India"],
    ["service_states", ["country-1"], "Uttar Pradesh"],
    ["service_cities", ["country-1", "state-1"], "Greater Noida"],
    ["service_areas", ["country-1", "state-1", "city-1"], "Gautam Buddha Nagar"],
    ["service_localities", ["country-1", "state-1", "city-1", "area-1"], "Gaur City 2"],
  ];
  for (const [collection, parents, name] of cases) {
    const id = serviceLocationNameIndexId(collection, parents, name);
    assert.match(id, /^[a-f0-9]{64}$/);
  }
});

test("rejects names longer than 120 normalized characters", () => {
  assert.throws(
    () => serviceLocationNameIndexId("service_countries", [], "x".repeat(121)),
    /LOCATION_INDEX_NAME_INVALID/,
  );
});
