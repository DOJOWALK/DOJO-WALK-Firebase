const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { saveServiceLocationWithNameIndex } = require("../lib/index");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");

const db = getFirestore();
const admins = new Set();
const countries = new Set();
const states = new Set();
const indexes = new Set();

function request(uid, data) {
  return { data, auth: uid ? { uid, token: { uid, role: "admin" } } : undefined, rawRequest: {}, acceptsStreaming: false };
}

async function createAdmin() {
  const uid = `hierarchy-test-${randomUUID()}`;
  admins.add(uid);
  await db.doc(`admin_users/${uid}`).set({ role: "admin", isActive: true });
  return uid;
}

function indexId(collection, parentIds, name) {
  const id = serviceLocationNameIndexId(collection, parentIds, name.trim().toLowerCase().replace(/\\s+/g, " "));
  indexes.add(id);
  return id;
}

async function save(uid, locationType, payload, locationId) {
  const data = { locationType, payload };
  if (locationId) data.locationId = locationId;
  const result = await saveServiceLocationWithNameIndex.run(request(uid, data));
  if (result.locationType === "country") countries.add(result.locationId);
  if (result.locationType === "state") states.add(result.locationId);
  return result;
}

test("same State name is unique under one Country but allowed under another", async () => {
  const uid = await createAdmin();
  const countryA = await save(uid, "country", { name: `Country-A-${randomUUID()}`, code: "AA" });
  const countryB = await save(uid, "country", { name: `Country-B-${randomUUID()}`, code: "BB" });
  const name = `Shared-State-${randomUUID()}`;
  const stateA = await save(uid, "state", { countryId: countryA.locationId, name });
  const indexAId = indexId("service_states", [countryA.locationId], name);

  await assert.rejects(
    () => save(uid, "state", { countryId: countryA.locationId, name }),
    (error) => error && error.code === "already-exists",
  );
  const stateB = await save(uid, "state", { countryId: countryB.locationId, name });
  const indexA = await db.doc(`service_location_name_indexes/${indexAId}`).get();
  const indexBId = indexId("service_states", [countryB.locationId], name);
  const indexB = await db.doc(`service_location_name_indexes/${indexBId}`).get();

  assert.notEqual(stateA.locationId, stateB.locationId);
  assert.equal(indexA.exists, true);
  assert.equal(indexA.get("documentId"), stateA.locationId);
  assert.equal(indexB.exists, true);
  assert.equal(indexB.get("documentId"), stateB.locationId);
});

test("saving an existing State with the same name and parent is idempotent", async () => {
  const uid = await createAdmin();
  const country = await save(uid, "country", { name: `Idempotent-Country-${randomUUID()}`, code: "IC" });
  const name = `Idempotent-State-${randomUUID()}`;
  const first = await save(uid, "state", { countryId: country.locationId, name });
  const second = await save(uid, "state", { countryId: country.locationId, name: `  ${name}  ` }, first.locationId);

  const state = await db.doc(`service_states/${first.locationId}`).get();
  const id = indexId("service_states", [country.locationId], name);
  const index = await db.doc(`service_location_name_indexes/${id}`).get();

  assert.equal(second.locationId, first.locationId);
  assert.equal(state.exists, true);
  assert.equal(state.get("name"), name);
  assert.equal(state.get("isActive"), false);
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), first.locationId);
});

test("State save rejects a parent Country that does not exist", async () => {
  const uid = await createAdmin();
  await assert.rejects(
    () => save(uid, "state", { countryId: `missing-country-${randomUUID()}`, name: `Orphan-State-${randomUUID()}` }),
    (error) => error && error.code === "failed-precondition",
  );
});

test.after(async () => {
  const deletes = [];
  for (const uid of admins) deletes.push(db.doc(`admin_users/${uid}`).delete());
  for (const id of states) deletes.push(db.doc(`service_states/${id}`).delete());
  for (const id of countries) deletes.push(db.doc(`service_countries/${id}`).delete());
  for (const id of indexes) deletes.push(db.doc(`service_location_name_indexes/${id}`).delete());
  await Promise.all(deletes);
});
