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
const cities = new Set();
const areas = new Set();
const localities = new Set();
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
  const id = serviceLocationNameIndexId(collection, parentIds, name.trim().toLowerCase().replace(/\s+/g, " "));
  indexes.add(id);
  return id;
}

async function save(uid, locationType, payload, locationId) {
  const data = { locationType, payload };
  if (locationId) data.locationId = locationId;
  const result = await saveServiceLocationWithNameIndex.run(request(uid, data));
  if (result.locationType === "country") {
    countries.add(result.locationId);
    indexId("service_countries", [], payload.name);
  }
  if (result.locationType === "state") {
    states.add(result.locationId);
    indexId("service_states", [payload.countryId], payload.name);
  }
  if (result.locationType === "city") {
    cities.add(result.locationId);
    indexId("service_cities", [payload.countryId, payload.stateId], payload.name);
  }
  if (result.locationType === "area") {
    areas.add(result.locationId);
    indexId("service_areas", [payload.countryId, payload.stateId, payload.cityId], payload.name);
  }
  if (result.locationType === "locality") {
    localities.add(result.locationId);
    indexId("service_localities", [payload.countryId, payload.stateId, payload.cityId, payload.areaId], payload.name);
  }
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

test("renaming a State replaces its name index atomically", async () => {
  const uid = await createAdmin();
  const country = await save(uid, "country", { name: `Rename-Country-${randomUUID()}`, code: "RC" });
  const oldName = `Old-State-${randomUUID()}`;
  const newName = `New-State-${randomUUID()}`;
  const state = await save(uid, "state", { countryId: country.locationId, name: oldName });
  const oldIndexId = indexId("service_states", [country.locationId], oldName);
  const newIndexId = indexId("service_states", [country.locationId], newName);

  const updated = await save(uid, "state", { countryId: country.locationId, name: newName }, state.locationId);

  const savedState = await db.doc(`service_states/${state.locationId}`).get();
  const oldIndex = await db.doc(`service_location_name_indexes/${oldIndexId}`).get();
  const newIndex = await db.doc(`service_location_name_indexes/${newIndexId}`).get();

  assert.equal(updated.locationId, state.locationId);
  assert.equal(savedState.get("name"), newName);
  assert.equal(oldIndex.exists, false);
  assert.equal(newIndex.exists, true);
  assert.equal(newIndex.get("documentId"), state.locationId);
  assert.equal(newIndex.get("name"), newName.toLowerCase());
});

test("renaming a State to a sibling name is rejected without changing either index", async () => {
  const uid = await createAdmin();
  const country = await save(uid, "country", { name: `Collision-Country-${randomUUID()}`, code: "CC" });
  const firstName = `Collision-First-${randomUUID()}`;
  const secondName = `Collision-Second-${randomUUID()}`;
  const first = await save(uid, "state", { countryId: country.locationId, name: firstName });
  const second = await save(uid, "state", { countryId: country.locationId, name: secondName });
  const firstIndexId = indexId("service_states", [country.locationId], firstName);
  const secondIndexId = indexId("service_states", [country.locationId], secondName);

  await assert.rejects(
    () => save(uid, "state", { countryId: country.locationId, name: secondName }, first.locationId),
    (error) => error && error.code === "already-exists",
  );

  const savedFirst = await db.doc(`service_states/${first.locationId}`).get();
  const savedSecond = await db.doc(`service_states/${second.locationId}`).get();
  const firstIndex = await db.doc(`service_location_name_indexes/${firstIndexId}`).get();
  const secondIndex = await db.doc(`service_location_name_indexes/${secondIndexId}`).get();

  assert.equal(savedFirst.get("name"), firstName);
  assert.equal(savedSecond.get("name"), secondName);
  assert.equal(firstIndex.exists, true);
  assert.equal(firstIndex.get("documentId"), first.locationId);
  assert.equal(secondIndex.exists, true);
  assert.equal(secondIndex.get("documentId"), second.locationId);
});

test("updating an existing State cannot change its parent Country", async () => {
  const uid = await createAdmin();
  const countryA = await save(uid, "country", { name: `Immutable-Parent-A-${randomUUID()}`, code: "IA" });
  const countryB = await save(uid, "country", { name: `Immutable-Parent-B-${randomUUID()}`, code: "IB" });
  const name = `Immutable-State-${randomUUID()}`;
  const state = await save(uid, "state", { countryId: countryA.locationId, name });
  const originalIndexId = indexId("service_states", [countryA.locationId], name);

  await assert.rejects(
    () => save(uid, "state", { countryId: countryB.locationId, name }, state.locationId),
    (error) => error && error.code === "failed-precondition",
  );

  const savedState = await db.doc(`service_states/${state.locationId}`).get();
  const originalIndex = await db.doc(`service_location_name_indexes/${originalIndexId}`).get();
  const newIndexId = indexId("service_states", [countryB.locationId], name);
  const newIndex = await db.doc(`service_location_name_indexes/${newIndexId}`).get();

  assert.equal(savedState.get("countryId"), countryA.locationId);
  assert.equal(originalIndex.exists, true);
  assert.equal(originalIndex.get("documentId"), state.locationId);
  assert.equal(newIndex.exists, false);
});

test("State save rejects a parent Country that does not exist", async () => {
  const uid = await createAdmin();
  await assert.rejects(
    () => save(uid, "state", { countryId: `missing-country-${randomUUID()}`, name: `Orphan-State-${randomUUID()}` }),
    (error) => error && error.code === "failed-precondition",
  );
});

test("Area and Locality saves reject mismatched hierarchy ancestry without writing records or indexes", async () => {
  const uid = await createAdmin();
  const countryA = await save(uid, "country", { name: `Hierarchy-Country-A-${randomUUID()}`, code: "HA" });
  const countryB = await save(uid, "country", { name: `Hierarchy-Country-B-${randomUUID()}`, code: "HB" });
  const stateA = await save(uid, "state", { countryId: countryA.locationId, name: `Hierarchy-State-A-${randomUUID()}` });
  const stateB = await save(uid, "state", { countryId: countryB.locationId, name: `Hierarchy-State-B-${randomUUID()}` });
  const cityA = await save(uid, "city", {
    countryId: countryA.locationId, stateId: stateA.locationId, name: `Hierarchy-City-A-${randomUUID()}`,
  });
  const cityB = await save(uid, "city", {
    countryId: countryB.locationId, stateId: stateB.locationId, name: `Hierarchy-City-B-${randomUUID()}`,
  });
  const areaA = await save(uid, "area", {
    countryId: countryA.locationId, stateId: stateA.locationId, cityId: cityA.locationId,
    name: `Hierarchy-Area-A-${randomUUID()}`,
  });

  const mismatchedAreaName = `Mismatched-Area-${randomUUID()}`;
  await assert.rejects(
    () => save(uid, "area", {
      countryId: countryA.locationId, stateId: stateA.locationId, cityId: cityB.locationId,
      name: mismatchedAreaName,
    }),
    (error) => error && error.code === "failed-precondition",
  );
  const mismatchedAreaIndex = indexId("service_areas", [countryA.locationId, stateA.locationId, cityB.locationId], mismatchedAreaName);
  assert.equal((await db.doc(`service_location_name_indexes/${mismatchedAreaIndex}`).get()).exists, false);
  const orphanAreas = await db.collection("service_areas").where("name", "==", mismatchedAreaName).get();
  assert.equal(orphanAreas.empty, true);

  const mismatchedLocalityName = `Mismatched-Locality-${randomUUID()}`;
  await assert.rejects(
    () => save(uid, "locality", {
      countryId: countryA.locationId, stateId: stateA.locationId, cityId: cityB.locationId,
      areaId: areaA.locationId, name: mismatchedLocalityName,
    }),
    (error) => error && error.code === "failed-precondition",
  );
  const mismatchedLocalityIndex = indexId("service_localities", [countryA.locationId, stateA.locationId, cityB.locationId, areaA.locationId], mismatchedLocalityName);
  assert.equal((await db.doc(`service_location_name_indexes/${mismatchedLocalityIndex}`).get()).exists, false);
  const orphanLocalities = await db.collection("service_localities").where("name", "==", mismatchedLocalityName).get();
  assert.equal(orphanLocalities.empty, true);
});

test.after(async () => {
  const deletes = [];
  for (const uid of admins) deletes.push(db.doc(`admin_users/${uid}`).delete());
  for (const id of localities) deletes.push(db.doc(`service_localities/${id}`).delete());
  for (const id of areas) deletes.push(db.doc(`service_areas/${id}`).delete());
  for (const id of cities) deletes.push(db.doc(`service_cities/${id}`).delete());
  for (const id of states) deletes.push(db.doc(`service_states/${id}`).delete());
  for (const id of countries) deletes.push(db.doc(`service_countries/${id}`).delete());
  for (const id of indexes) deletes.push(db.doc(`service_location_name_indexes/${id}`).delete());
  await Promise.all(deletes);
});
