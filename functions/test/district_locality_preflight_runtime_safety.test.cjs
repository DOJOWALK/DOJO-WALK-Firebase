const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = fs.readFileSync(
  path.join(__dirname, "../scripts/district_locality_migration_preflight.cjs"),
  "utf8",
);

test("Locality preflight preserves the actual Firestore document ID", () => {
  assert.match(source, /\{ \.\.\.s\.data\(\), id: s\.id \}/);
});

test("Locality preflight separates read failures from broken data", () => {
  assert.match(source, /READ_ERROR: 0/);
  assert.match(source, /FIRESTORE_OR_INDEX_HELPER_READ_FAILED/);
  assert.match(source, /knownDataErrors\.has\(message\)/);
});

test("proposed Locality index must match owner, collection, normalized name, and full parent tuple", () => {
  assert.match(source, /proposed\.collectionPath === "service_localities"/);
  assert.match(source, /proposed\.documentId === localityId/);
  assert.match(source, /proposed\.name === norm\(l\.name\)/);
  assert.match(source, /\[\s*l\.countryId,\s*l\.stateId,\s*c\.districtId,\s*l\.cityId,\s*l\.areaId,\s*\]/);
  assert.match(source, /proposedIndexMatches/);
});

test("Locality preflight remains paginated and contains no Firestore writes", () => {
  assert.match(source, /collection\("service_localities"\)\.orderBy\("__name__"\)\.limit\(pageSize\)/);
  assert.match(source, /startAfter\(cursor\)/);
  assert.doesNotMatch(source, /\.set\(|\.create\(|\.update\(|\.delete\(/);
});

test("Locality preflight script passes Node syntax validation", () => {
  const scriptPath = path.join(__dirname, "../scripts/district_locality_migration_preflight.cjs");
  const result = spawnSync(process.execPath, ["--check", scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || "node --check failed");
});

test("Locality preflight reports Firestore failures separately", () => {
  assert.match(source, /READ_ERROR: 0/);
  assert.match(source, /knownDataErrors\.has\(message\)/);
  assert.match(source, /FIRESTORE_OR_INDEX_HELPER_READ_FAILED/);
});
