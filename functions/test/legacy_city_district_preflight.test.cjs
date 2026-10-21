const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyLegacyCityDistrictMapping } = require("../lib/legacy_city_district_preflight");

const base = {
  cityId: "city-1",
  countryId: "india",
  stateId: "up",
  currentDistrictId: "",
  candidates: [{
    districtId: "district-1",
    countryId: "india",
    stateId: "up",
    evidenceReference: "LGD-DISTRICT-001",
  }],
};
const approval = {
  cityId: "city-1",
  districtId: "district-1",
  expectedCountryId: "india",
  expectedStateId: "up",
  evidenceReference: "LGD-DISTRICT-001",
  reviewer: "reviewer-1",
  reviewedAt: "2026-10-22T00:00:00Z",
};

test("missing District stays a candidate, not an automatic mapping", () => {
  const result = classifyLegacyCityDistrictMapping(base);
  assert.equal(result.status, "UNIQUE_EVIDENCE_CANDIDATE");
  assert.equal(result.safeToApply, false);
});

test("no authoritative candidates require manual review", () => {
  const result = classifyLegacyCityDistrictMapping({ ...base, candidates: [] });
  assert.equal(result.status, "NO_CANDIDATE");
  assert.equal(result.safeToApply, false);
});

test("multiple parent-consistent candidates are ambiguous", () => {
  const result = classifyLegacyCityDistrictMapping({
    ...base,
    candidates: [
      ...base.candidates,
      { districtId: "district-2", countryId: "india", stateId: "up", evidenceReference: "LGD-DISTRICT-002" },
    ],
  });
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.safeToApply, false);
});

test("candidate with mismatched parent is rejected", () => {
  const result = classifyLegacyCityDistrictMapping({
    ...base,
    candidates: [{ districtId: "district-x", countryId: "india", stateId: "dl", evidenceReference: "LGD-X" }],
  });
  assert.equal(result.status, "PARENT_MISMATCH");
  assert.equal(result.safeToApply, false);
});

test("matching reviewed manifest may be marked ready but performs no write", () => {
  const result = classifyLegacyCityDistrictMapping({ ...base, approvedMapping: approval });
  assert.equal(result.status, "REVIEWED_MAPPING_READY");
  assert.equal(result.safeToApply, true);
  assert.match(result.reason, /separately approved write implementation/);
});

test("malformed reviewedAt timestamps are rejected", () => {
  for (const reviewedAt of ["not-a-date", "2026-99-99T00:00:00Z", "", "2026-10-22"]) {
    const result = classifyLegacyCityDistrictMapping({
      ...base,
      approvedMapping: { ...approval, reviewedAt },
    });
    assert.equal(result.status, "MANIFEST_MISMATCH", reviewedAt);
    assert.equal(result.safeToApply, false, reviewedAt);
  }
});

test("wrong District or stale parent in manifest is rejected", () => {
  const result = classifyLegacyCityDistrictMapping({
    ...base,
    approvedMapping: { ...approval, districtId: "district-other" },
  });
  assert.equal(result.status, "MANIFEST_MISMATCH");
  assert.equal(result.safeToApply, false);
});

test("already-linked City is reported without changing it", () => {
  const result = classifyLegacyCityDistrictMapping({ ...base, currentDistrictId: "district-existing" });
  assert.equal(result.status, "ALREADY_LINKED");
  assert.equal(result.safeToApply, false);
  assert.deepEqual(result.candidateDistrictIds, ["district-existing"]);
});

test("malformed candidate and duplicate candidate IDs fail closed", () => {
  const malformed = classifyLegacyCityDistrictMapping({
    ...base,
    candidates: [{ districtId: "bad id", countryId: "india", stateId: "up", evidenceReference: "ref" }],
  });
  assert.equal(malformed.status, "INPUT_INVALID");
  const duplicate = classifyLegacyCityDistrictMapping({
    ...base,
    candidates: [...base.candidates, { ...base.candidates[0] }],
  });
  assert.equal(duplicate.status, "INPUT_INVALID");
});
