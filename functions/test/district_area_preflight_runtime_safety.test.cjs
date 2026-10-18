const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = fs.readFileSync(
  path.join(__dirname, "../scripts/district_migration_preflight.cjs"),
  "utf8",
);

test("Area preflight preserves actual Firestore document IDs", () => {
  assert.match(source, /\{ \.\.\.snap\.data\(\), id: snap\.id \}/);
});

test("Area preflight separates malformed records from Firestore/helper read errors", () => {
  assert.match(source, /READ_ERROR: 0/);
  assert.match(source, /FIRESTORE_OR_INDEX_HELPER_READ_FAILED/);
  assert.match(source, /knownDataErrors\.has\(message\)/);
});

test("Area proposed index checks collection, owner, normalized name and full District parent tuple", () => {
  assert.match(source, /proposedIndex\.collectionPath === "service_areas"/);
  assert.match(source, /proposedIndex\.documentId === areaId/);
  assert.match(source, /proposedIndex\.name === normalizeName\(area\.name\)/);
  assert.match(source, /\[\s*area\.countryId,\s*area\.stateId,\s*city\.districtId,\s*area\.cityId,\s*\]/);
  assert.match(source, /if \(proposedIndexOwnerId === areaId && !proposedIndexMatches\) status = "INDEX_CONFLICT"/);
});

test("Area preflight validates name and documents all statuses", () => {
  assert.match(source, /typeof area\.name !== "string" \|\| !area\.name\.trim\(\) \|\| area\.name\.trim\(\)\.length > 120/);
  for (const status of [
    "READY", "LEGACY_NO_DISTRICT", "BROKEN_PARENT_CHAIN",
    "INDEX_CONFLICT", "LEGACY_INDEX_MISSING_OR_MISMATCHED", "READ_ERROR",
  ]) assert.match(source, new RegExp(status + ":"));
});

test("Area preflight is paginated, read-only and passes Node syntax validation", () => {
  assert.match(source, /collection\("service_areas"\)\.orderBy\("__name__"\)\.limit\(pageSize\)/);
  assert.match(source, /startAfter\(lastDoc\)/);
  assert.doesNotMatch(source, /\.set\(|\.create\(|\.update\(|\.delete\(/);
  const result = spawnSync(process.execPath, ["--check", path.join(__dirname, "../scripts/district_migration_preflight.cjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || "node --check failed");
});
