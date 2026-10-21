const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("City District inventory refuses to guess a Firebase project", () => {
  const script = path.join(__dirname, "..", "scripts", "legacy_city_district_inventory.cjs");
  const env = { ...process.env };
  delete env.GCLOUD_PROJECT;
  delete env.GOOGLE_CLOUD_PROJECT;
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env,
    timeout: 5000,
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT explicitly/);
  assert.doesNotMatch(result.stdout, /read-only-service-city-district-inventory/);
});
