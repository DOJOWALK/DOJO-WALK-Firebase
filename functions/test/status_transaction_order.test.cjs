const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("District activation reads its Country before the first transaction write", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/index.ts"),
    "utf8",
  );
  const start = source.indexOf("export const setServiceLocationStatus");
  const end = source.indexOf("export const saveServiceLocationWithNameIndex", start);
  assert.notEqual(start, -1, "status callable should exist");
  assert.notEqual(end, -1, "save callable should follow status callable");
  const status = source.slice(start, end);

  const districtCountryRead = status.indexOf("await tx.get(districtCountryRef)");
  const firstTransactionWrite = status.indexOf("tx.update(targetRef");
  assert.notEqual(districtCountryRead, -1, "District activation must read Country in transaction");
  assert.notEqual(firstTransactionWrite, -1, "status callable must write the target status");
  assert.ok(
    districtCountryRead < firstTransactionWrite,
    "Firestore transaction reads must complete before the first write",
  );

  const districtBranch = status.indexOf(
    'if (isActive && locationType === "district" && parentRef && districtCountryRef)',
  );
  assert.notEqual(districtBranch, -1, "District ancestor guards should be written");
  assert.ok(districtBranch > firstTransactionWrite, "ancestor guard writes should follow target validation");
  assert.doesNotMatch(
    status.slice(firstTransactionWrite),
    /await tx\.get\(districtCountryRef\)/,
    "District Country must not be read after transaction writes begin",
  );
});
