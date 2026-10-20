const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const {
  manageServiceLocationImportRun,
  saveServiceLocationWithNameIndex,
} = require("../lib/index");

const db = getFirestore();
const created = [];

function request(uid, data) {
  return { data, auth: uid ? { uid, token: { uid, role: "super_admin" } } : undefined, rawRequest: {}, acceptsStreaming: false };
}

async function save(uid, locationType, locationId, payload) {
  const result = await saveServiceLocationWithNameIndex.run(request(uid, {
    locationType, locationId, payload,
  }));
  assert.equal(result.locationId, locationId);
  return result;
}

test("CSV import callable flow writes an inactive State-District-City-Area hierarchy and final audit", async () => {
  const uid = `csv-flow-${randomUUID()}`;
  const suffix = randomUUID().replace(/-/g, "");
  const countryId = `country_${suffix}`;
  const stateId = `state_${suffix}`;
  const districtId = `district_${suffix}`;
  const cityId = `city_${suffix}`;
  const areaId = `area_${suffix}`;
  const runId = `run_${suffix}`;
  const fingerprint = `sha256:${"a".repeat(64)}`;
  created.push(uid, countryId, stateId, districtId, cityId, areaId, runId);

  await db.doc(`admin_users/${uid}`).set({ role: "super_admin", isActive: true });
  // The country is selected in Admin before the CSV's State → Area hierarchy.
  await save(uid, "country", countryId, { name: `Test Country ${suffix}`, code: "ZZ" });

  const plan = [
    { id: stateId, type: "state", name: `Test State ${suffix}`, parentId: countryId, alreadyExists: false, sourceLine: 2 },
    { id: districtId, type: "district", name: `Test District ${suffix}`, parentId: stateId, alreadyExists: false, sourceLine: 2 },
    { id: cityId, type: "city", name: `Test City ${suffix}`, parentId: districtId, alreadyExists: false, sourceLine: 2 },
    { id: areaId, type: "area", name: `Test Area ${suffix}`, parentId: cityId, alreadyExists: false, sourceLine: 2 },
  ];

  const begun = await manageServiceLocationImportRun.run(request(uid, {
    action: "begin", runId, inputFingerprint: fingerprint,
    countryId, fileName: "test-hierarchy.csv",
  }));
  assert.equal(begun.status, "started");

  const recorded = await manageServiceLocationImportRun.run(request(uid, {
    action: "recordPlan", runId, inputFingerprint: fingerprint, nodes: plan,
  }));
  assert.equal(recorded.plannedRecords, 4);

  await save(uid, "state", stateId, { countryId, name: plan[0].name });
  await save(uid, "district", districtId, { countryId, stateId, name: plan[1].name });
  await save(uid, "city", cityId, { countryId, stateId, districtId, name: plan[2].name });
  await save(uid, "area", areaId, { countryId, stateId, cityId, name: plan[3].name });

  for (const [collection, id] of [
    ["service_states", stateId],
    ["service_districts", districtId],
    ["service_cities", cityId],
    ["service_areas", areaId],
  ]) {
    const doc = await db.doc(`${collection}/${id}`).get();
    assert.equal(doc.exists, true, `${collection}/${id} should be written`);
    assert.notEqual(doc.get("isActive"), true, "CSV import must never activate a location");
    assert.notEqual(doc.get("isServiceActive"), true, "CSV import must never activate service");
  }

  const finalized = await manageServiceLocationImportRun.run(request(uid, {
    action: "finalize", runId, inputFingerprint: fingerprint,
    status: "completed", plannedRecords: 4, createdRecords: 4, reusedRecords: 0,
  }));
  assert.equal(finalized.status, "completed");
  assert.equal(finalized.auditWritten, true);

  const audit = await db.doc(`service_location_imports/${runId}`).get();
  assert.equal(audit.exists, true);
  assert.equal(audit.get("status"), "completed");
  assert.equal(audit.get("inputFingerprint"), fingerprint);
  // Counts live on the durable run marker; the operator-facing audit stores
  // immutable status/source metadata and intentionally omits mutable summaries.
  const run = await db.doc(`service_location_import_runs/${runId}`).get();
  assert.equal(run.exists, true);
  assert.equal(run.get("plannedRecords"), 4);
  assert.equal(run.get("createdRecords"), 4);
  assert.equal(run.get("reusedRecords"), 0);

  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      action: "begin", runId, inputFingerprint: fingerprint,
      countryId, fileName: "test-hierarchy.csv",
    })),
    (error) => error && error.code === "already-exists",
    "a repeated import run must be blocked rather than replaying hierarchy writes",
  );
});
