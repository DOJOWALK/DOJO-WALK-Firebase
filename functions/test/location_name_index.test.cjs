const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  normalizeServiceLocationName,
  serviceLocationNameIndexId,
} = require("../lib/location_name_index");
const { validateServiceLocationPayload } = require("../lib/location_name_index");

test("validates parent IDs and trims them before persisting payload data", () => {
  const normalized = validateServiceLocationPayload("state", {
    countryId: " country-1 ",
    name: " Uttar   Pradesh ",
  });
  assert.deepEqual(normalized, {
    countryId: "country-1",
    name: "Uttar   Pradesh",
  });
});

test("payload validation rejects parent IDs containing path separators or embedded spaces", () => {
  assert.throws(
    () => validateServiceLocationPayload("state", {
      countryId: "country/child",
      name: "Uttar Pradesh",
    }),
    /LOCATION_INDEX_PARENT_INVALID/,
  );
  assert.throws(
    () => validateServiceLocationPayload("state", {
      countryId: "country id",
      name: "Uttar Pradesh",
    }),
    /LOCATION_INDEX_PARENT_INVALID/,
  );
});

test("normalizes name with trim, lowercase, and collapsed whitespace", () => {
  assert.equal(normalizeServiceLocationName("  Gaur   CITY  2 "), "gaur city 2");
});

test("matches the Dart JSON tuple SHA-256 contract", () => {
  const tuple = JSON.stringify(["service_states", ["country-1"], "uttar pradesh"]);
  const expected = createHash("sha256").update(Buffer.from(tuple, "utf8")).digest("hex");
  assert.equal(serviceLocationNameIndexId("service_states", [" country-1 "], " Uttar   Pradesh "), expected);
});

test("different parent chains produce different index IDs", () => {
  assert.notEqual(
    serviceLocationNameIndexId("service_cities", ["country-1", "state-1"], "Noida"),
    serviceLocationNameIndexId("service_cities", ["country-1", "state-2"], "Noida"),
  );
});

test("rejects invalid collection, empty name, and wrong parent count", () => {
  assert.throws(() => serviceLocationNameIndexId("users", [], "Noida"), /LOCATION_INDEX_COLLECTION_INVALID/);
  assert.throws(() => serviceLocationNameIndexId("service_countries", [], "   "), /LOCATION_INDEX_NAME_INVALID/);
  assert.throws(() => serviceLocationNameIndexId("service_states", [], "Uttar Pradesh"), /LOCATION_INDEX_PARENT_COUNT_INVALID/);
});

test("rejects parent IDs containing path separators or whitespace", () => {
  assert.throws(
    () => serviceLocationNameIndexId("service_states", ["country/child"], "Uttar Pradesh"),
    /LOCATION_INDEX_PARENT_INVALID/,
  );
  assert.throws(
    () => serviceLocationNameIndexId("service_states", ["country id"], "Uttar Pradesh"),
    /LOCATION_INDEX_PARENT_INVALID/,
  );
});

test("rejects empty or oversized parent IDs", () => {
  assert.throws(() => serviceLocationNameIndexId("service_states", ["  "], "Uttar Pradesh"), /LOCATION_INDEX_PARENT_INVALID/);
  assert.throws(() => serviceLocationNameIndexId("service_states", ["x".repeat(129)], "Uttar Pradesh"), /LOCATION_INDEX_PARENT_INVALID/);
});

test("supports District index tuple with Country and State parents", () => {
  const tuple = JSON.stringify([
    "service_districts",
    ["country-1", "state-1"],
    "gautam buddha nagar",
  ]);
  const expected = createHash("sha256").update(Buffer.from(tuple, "utf8")).digest("hex");
  assert.equal(
    serviceLocationNameIndexId(
      "service_districts",
      ["country-1", "state-1"],
      " Gautam   Buddha Nagar ",
    ),
    expected,
  );
});

test("validates a District payload with Country and State parents", () => {
  assert.deepEqual(validateServiceLocationPayload("district", {
    countryId: "country-1",
    stateId: "state-1",
    name: " Gautam Buddha Nagar ",
  }), {
    countryId: "country-1",
    stateId: "state-1",
    name: "Gautam Buddha Nagar",
  });
});

test("still rejects districtId on City until district-aware City migration lands", () => {
  assert.throws(
    () => validateServiceLocationPayload("city", {
      countryId: "country-1",
      stateId: "state-1",
      districtId: "district-1",
      name: "Noida",
    }),
    /LOCATION_PAYLOAD_FIELD_INVALID/,
  );
});
