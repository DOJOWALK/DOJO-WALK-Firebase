const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyAreaMigrationPreflight } = require("../lib/district_schema_contract");
const scanner = fs.readFileSync(path.join(__dirname, "../scripts/district_locality_migration_preflight.cjs"), "utf8");

test("classification: Locality without District mapping is manual review", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "LEGACY_NO_DISTRICT",
    legacyIndexMatches: true,
    proposedIndexOwnerId: null,
    areaId: "locality-1",
  }), "LEGACY_NO_DISTRICT");
});

test("classification: broken parent ancestry blocks readiness", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "BROKEN_PARENT_CHAIN",
    legacyIndexMatches: true,
    proposedIndexOwnerId: null,
    areaId: "locality-1",
  }), "BROKEN_PARENT_CHAIN");
});

test("classification: missing or mismatched legacy index blocks readiness", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: false,
    proposedIndexOwnerId: null,
    areaId: "locality-1",
  }), "LEGACY_INDEX_MISSING_OR_MISMATCHED");
});

test("classification: proposed index owned by another Locality is a conflict", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: true,
    proposedIndexOwnerId: "locality-2",
    areaId: "locality-1",
  }), "INDEX_CONFLICT");
});

test("classification: clean ancestry and unoccupied proposed index can be READY", () => {
  assert.equal(classifyAreaMigrationPreflight({
    cityCompatibility: "DISTRICT_LINKED",
    legacyIndexMatches: true,
    proposedIndexOwnerId: null,
    areaId: "locality-1",
  }), "READY");
});

test("scanner maps known malformed ancestry separately from read failures", () => {
  assert.match(scanner, /knownDataErrors\.has\(message\)/);
  assert.match(scanner, /status = "BROKEN_PARENT_CHAIN"/);
  assert.match(scanner, /status = "READ_ERROR"/);
  assert.match(scanner, /FIRESTORE_OR_INDEX_HELPER_READ_FAILED/);
});

test("scanner checks proposed index consistency before reporting it", () => {
  assert.match(scanner, /proposedIndexMatches = !!proposed/);
  assert.match(scanner, /if \(proposedIndexOwnerId === localityId && !proposedIndexMatches\) status = "INDEX_CONFLICT"/);
});
