const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const {
  resolveProjectId,
  parsePageSize,
  writeReport,
  runInventory,
} = require("../scripts/legacy_city_district_inventory.cjs");

function fakeFirestore(collections, failures = {}) {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const key = name + "/" + id;
              if (failures[key]) throw failures[key];
              const data = collections[name] && collections[name][id];
              return {
                exists: data !== undefined,
                id,
                data: () => data,
              };
            },
          };
        },
        orderBy() {
          let limitValue = 200;
          let cursorId = null;
          const query = {
            limit(value) { limitValue = value; return query; },
            startAfter(doc) { cursorId = doc.id; return query; },
            async get() {
              const all = Object.entries(collections[name] || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, data]) => ({
                  id,
                  data: () => data,
                }));
              const start = cursorId === null ? 0 : all.findIndex((doc) => doc.id === cursorId) + 1;
              const docs = all.slice(start, start + limitValue);
              return { docs, empty: docs.length === 0, size: docs.length };
            },
          };
          return query;
        },
      };
    },
  };
}

test("project resolution requires an explicit project and never guesses", () => {
  assert.equal(resolveProjectId({}), "");
  assert.equal(resolveProjectId({ GCLOUD_PROJECT: "project-a" }), "project-a");
  assert.equal(resolveProjectId({ GOOGLE_CLOUD_PROJECT: "project-b" }), "project-b");
  assert.equal(resolveProjectId({ GCLOUD_PROJECT: "", GOOGLE_CLOUD_PROJECT: "project-b" }), "project-b");
});

test("scanner CLI refuses to run without an explicit project", () => {
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

test("page size is clamped to the supported range", () => {
  assert.equal(parsePageSize(undefined), 200);
  assert.equal(parsePageSize("0"), 200);
  assert.equal(parsePageSize("-5"), 1);
  assert.equal(parsePageSize("9999"), 500);
  assert.equal(parsePageSize("2"), 2);
});

test("inventory paginates and classifies linked, legacy, broken and read-error Cities", async () => {
  const collections = {
    service_cities: {
      city_a: { countryId: "country_a", stateId: "state_a", districtId: "district_a" },
      city_b: { countryId: "country_a", stateId: "state_a" },
      city_c: { countryId: "country_a", stateId: "state_wrong", districtId: "district_a" },
      city_d: { countryId: "country_a", stateId: "state_a" },
    },
    service_countries: { country_a: { active: true } },
    service_states: {
      state_a: { countryId: "country_a" },
      state_wrong: { countryId: "country_a" },
    },
    service_districts: {
      district_a: { countryId: "country_a", stateId: "state_a" },
    },
  };
  const denied = new Error("permission denied");
  denied.code = "permission-denied";
  // Keep the ordinary parent chain readable and simulate one isolated read failure.
  const adjusted = fakeFirestore(collections, { "service_states/state_read_error": denied });
  collections.service_cities.city_d = {
    countryId: "country_a", stateId: "state_read_error", districtId: "district_a",
  };
  collections.service_states.state_read_error = { countryId: "country_a" };

  const { report } = await runInventory({
    db: adjusted,
    projectId: "test-project",
    pageSize: 2,
    writeReportFn: async (pathValue, json) => {
      assert.equal(pathValue, null);
      assert.ok(json.includes('"firestoreWritesPerformed": false'));
    },
  });

  assert.equal(report.scanned, 4);
  assert.equal(report.counts.DISTRICT_LINKED, 1);
  assert.equal(report.counts.LEGACY_NO_DISTRICT, 1);
  assert.equal(report.counts.BROKEN_PARENT_CHAIN, 1);
  assert.equal(report.counts.READ_ERROR, 1);
  assert.deepEqual(report.records.map((record) => record.cityId), ["city_a", "city_b", "city_c", "city_d"]);
  assert.equal(report.safety.firestoreWritesPerformed, false);
  assert.equal(report.safety.districtNamesUsedForInference, false);
  assert.equal(report.safety.locationNamesIncluded, false);
  assert.equal(report.safety.approvalForMigration, false);
});

test("malformed parent document IDs are classified without a Firestore read", async () => {
  const db = fakeFirestore({
    service_cities: { city_a: { countryId: "country/a", stateId: "state_a" } },
  });
  const { report } = await runInventory({ db, projectId: "test-project" });
  assert.equal(report.counts.BROKEN_PARENT_CHAIN, 1);
  assert.equal(report.records[0].reason, "DOCUMENT_ID_INVALID");
});

test("report creation is exclusive and refuses to overwrite an existing report", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dojo-inventory-test-"));
  const reportPath = path.join(directory, "report.json");
  try {
    await writeReport(reportPath, '{"first":true}\n');
    assert.equal(fs.readFileSync(reportPath, "utf8"), '{"first":true}\n');
    await assert.rejects(() => writeReport(reportPath, '{"second":true}\n'));
    assert.equal(fs.readFileSync(reportPath, "utf8"), '{"first":true}\n');
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
