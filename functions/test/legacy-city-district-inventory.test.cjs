const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLegacyCityDistrictInventory } = require("../lib/legacy_city_district_inventory.js");

const districts = [
  { id: "d1", countryId: "india", stateId: "up", name: "Alpha District" },
  { id: "d2", countryId: "india", stateId: "up", name: "Beta District" },
  { id: "d3", countryId: "india", stateId: "dl", name: "Delhi District" },
];

function run(cities, evidenceCandidates = {}) {
  return buildLegacyCityDistrictInventory({ cities, districts, evidenceCandidates });
}

test("missing and empty districtId are classified as legacy without assigning a District", () => {
  const rows = run([
    { id: "c1", name: "Same Name", countryId: "india", stateId: "up" },
    { id: "c2", name: "Same Name", countryId: "india", stateId: "up", districtId: "" },
  ]);
  assert.deepEqual(rows.map((row) => row.status), ["no_candidate", "no_candidate"]);
  assert.deepEqual(rows.map((row) => row.currentDistrictId), [null, null]);
});

test("one authoritative parent-consistent candidate is only a proposal", () => {
  const rows = run(
    [{ id: "c1", name: "Shared City", countryId: "india", stateId: "up" }],
    { c1: ["d1"] },
  );
  assert.equal(rows[0].status, "unique_evidence_candidate");
  assert.deepEqual(rows[0].candidateDistrictIds, ["d1"]);
  assert.equal(rows[0].currentDistrictId, null);
});

test("multiple evidence candidates are ambiguous even if city names match", () => {
  const rows = run(
    [{ id: "c1", name: "Same Name", countryId: "india", stateId: "up" }],
    { c1: ["d2", "d1", "d1"] },
  );
  assert.equal(rows[0].status, "ambiguous");
  assert.deepEqual(rows[0].candidateDistrictIds, ["d1", "d2"]);
  assert.equal(rows[0].currentDistrictId, null);
});

test("no evidence candidate means no candidate; name similarity is not used", () => {
  const rows = run(
    [{ id: "c1", name: "Alpha District", countryId: "india", stateId: "up" }],
  );
  assert.equal(rows[0].status, "no_candidate");
  assert.deepEqual(rows[0].candidateDistrictIds, []);
});

test("candidate District with mismatched parent is rejected", () => {
  const rows = run(
    [{ id: "c1", name: "City", countryId: "india", stateId: "up" }],
    { c1: ["d3"] },
  );
  assert.equal(rows[0].status, "parent_mismatch");
});

test("existing linked City is accepted only when District parents match", () => {
  const rows = run([
    { id: "c1", name: "City", countryId: "india", stateId: "up", districtId: "d1" },
    { id: "c2", name: "City", countryId: "india", stateId: "up", districtId: "d3" },
    { id: "c3", name: "City", countryId: "india", stateId: "up", districtId: "missing" },
  ]);
  assert.deepEqual(rows.map((row) => row.status), [
    "already_linked", "parent_mismatch", "parent_mismatch",
  ]);
});

test("missing City identity or parent IDs is invalid", () => {
  const rows = run([
    { id: "", name: "City", countryId: "india", stateId: "up" },
    { id: "c2", name: "City", countryId: "", stateId: "up" },
  ]);
  assert.deepEqual(rows.map((row) => row.status), ["invalid_record", "invalid_record"]);
});

test("each City appears exactly once and input data is not mutated", () => {
  const cities = [
    { id: "c1", name: "One", countryId: "india", stateId: "up" },
    { id: "c2", name: "Two", countryId: "india", stateId: "up" },
  ];
  const before = structuredClone(cities);
  const rows = run(cities, { c1: ["d1"] });
  assert.equal(rows.length, cities.length);
  assert.deepEqual(rows.map((row) => row.cityId), ["c1", "c2"]);
  assert.deepEqual(cities, before);
});

test("invalid candidate IDs cannot become proposals", () => {
  const rows = run(
    [{ id: "c1", name: "City", countryId: "india", stateId: "up" }],
    { c1: ["bad id"] },
  );
  assert.equal(rows[0].status, "no_candidate");
  assert.deepEqual(rows[0].candidateDistrictIds, []);
});
