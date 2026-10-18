const test = require("node:test");
const assert = require("node:assert/strict");
const { validateServiceLocationPayload } = require("../lib/location_name_index");

test("accepts allow-listed payload for each location type", () => {
  const payloads = [
    ["country", { name: "India", code: "IN", isActive: false }],
    ["state", { countryId: "country-1", name: "Uttar Pradesh", isActive: false }],
    ["city", { countryId: "country-1", stateId: "state-1", name: "Greater Noida", isServiceActive: false }],
    ["area", { countryId: "country-1", stateId: "state-1", cityId: "city-1", name: "Gautam Buddha Nagar", isServiceActive: false }],
    ["locality", { countryId: "country-1", stateId: "state-1", cityId: "city-1", areaId: "area-1", name: "Gaur City 2", isServiceActive: false }],
  ];
  for (const [type, payload] of payloads) {
    assert.equal(validateServiceLocationPayload(type, payload).name, payload.name);
  }
});

test("trims country code after validating it", () => {
  const normalized = validateServiceLocationPayload("country", {
    name: " India ",
    code: " IN ",
  });
  assert.deepEqual(normalized, { name: "India", code: "IN" });
});

test("rejects fields outside the per-type allowlist", () => {
  assert.throws(
    () => validateServiceLocationPayload("state", { countryId: "country-1", name: "UP", isActive: false, admin: true }),
    /LOCATION_PAYLOAD_FIELD_INVALID/,
  );
});

test("rejects missing or malformed hierarchy parents", () => {
  assert.throws(
    () => validateServiceLocationPayload("city", { countryId: "country-1", stateId: " ", name: "Noida" }),
    /LOCATION_INDEX_PARENT_INVALID/,
  );
});

test("rejects empty or oversized names and invalid country code", () => {
  assert.throws(() => validateServiceLocationPayload("country", { name: " ", code: "IN" }), /LOCATION_INDEX_NAME_INVALID/);
  assert.throws(() => validateServiceLocationPayload("country", { name: "x".repeat(121), code: "IN" }), /LOCATION_INDEX_NAME_INVALID/);
  assert.throws(() => validateServiceLocationPayload("country", { name: "India", code: " " }), /LOCATION_PAYLOAD_CODE_INVALID/);
});
