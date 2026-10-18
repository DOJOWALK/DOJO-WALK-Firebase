const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const {
  saveServiceLocationWithNameIndex,
} = require("../lib/index");
const {
  serviceLocationNameIndexId,
} = require("../lib/location_name_index");

const db = getFirestore();
const createdAdmins = new Set();
const createdCountries = new Set();
const createdIndexes = new Set();

function request(uid, data) {
  return {
    data,
    auth: uid ? { uid, token: { uid, role: "admin" } } : undefined,
    rawRequest: {},
    acceptsStreaming: false,
  };
}

async function createAdmin(role = "admin", isActive = true) {
  const uid = `callable-test-${randomUUID()}`;
  createdAdmins.add(uid);
  await db.doc(`admin_users/${uid}`).set({ role, isActive });
  return uid;
}

function countryIndexId(name) {
  const id = serviceLocationNameIndexId(
    "service_countries",
    [],
    name.trim().toLowerCase().replace(/\s+/g, " "),
  );
  createdIndexes.add(id);
  return id;
}

async function saveCountry(uid, name, locationId) {
  const payload = { name, code: "IN" };
  const data = { locationType: "country", payload };
  if (locationId) data.locationId = locationId;
  const result = await saveServiceLocationWithNameIndex.run(request(uid, data));
  if (result?.locationId) createdCountries.add(result.locationId);
  return result;
}

test("unauthenticated country creation leaves no location or name index", async () => {
  const name = `Unauth-Create-${randomUUID()}`;
  const indexId = countryIndexId(name);

  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(undefined, {
      locationType: "country",
      payload: { name, code: "IN" },
    })),
    (error) => error && error.code === "unauthenticated",
  );

  const matching = await db.collection("service_countries").where("name", "==", name).get();
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(matching.empty, true);
  assert.equal(index.exists, false);
});

test("callable rejects a missing or inactive admin profile", async () => {
  const missingUid = `missing-${randomUUID()}`;
  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(missingUid, {
      locationType: "country",
      payload: { name: `Missing-${randomUUID()}`, code: "IN" },
    })),
    (error) => error && error.code === "permission-denied",
  );

  const inactiveUid = await createAdmin("admin", false);
  const inactiveName = `Inactive-Create-${randomUUID()}`;
  const inactiveIndexId = countryIndexId(inactiveName);
  await assert.rejects(
    () => saveCountry(inactiveUid, inactiveName),
    (error) => error && error.code === "permission-denied",
  );

  const inactiveMatches = await db.collection("service_countries")
    .where("name", "==", inactiveName).get();
  const inactiveIndex = await db.doc(
    `service_location_name_indexes/${inactiveIndexId}`,
  ).get();
  assert.equal(inactiveMatches.empty, true);
  assert.equal(inactiveIndex.exists, false);
});

test("unauthenticated request cannot rename an existing country or alter its index", async () => {
  const activeUid = await createAdmin();
  const originalName = `Unauth-Rename-Original-${randomUUID()}`;
  const replacementName = `Unauth-Rename-New-${randomUUID()}`;
  const created = await saveCountry(activeUid, originalName);
  const originalIndexId = countryIndexId(originalName);
  const replacementIndexId = countryIndexId(replacementName);

  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(undefined, {
      locationType: "country",
      locationId: created.locationId,
      payload: { name: replacementName, code: "IN" },
    })),
    (error) => error && error.code === "unauthenticated",
  );

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const originalIndex = await db.doc(`service_location_name_indexes/${originalIndexId}`).get();
  const replacementIndex = await db.doc(`service_location_name_indexes/${replacementIndexId}`).get();

  assert.equal(country.get("name"), originalName);
  assert.equal(originalIndex.exists, true);
  assert.equal(originalIndex.get("documentId"), created.locationId);
  assert.equal(replacementIndex.exists, false);
});

test("viewer role cannot create a country or its name index", async () => {
  const viewerUid = await createAdmin("viewer", true);
  const name = `Viewer-Create-${randomUUID()}`;
  const indexId = countryIndexId(name);

  await assert.rejects(
    () => saveCountry(viewerUid, name),
    (error) => error && error.code === "permission-denied",
  );

  assert.equal((await db.doc(`service_location_name_indexes/${indexId}`).get()).exists, false);
  const matching = await db.collection("service_countries").where("name", "==", name).get();
  assert.equal(matching.empty, true);
});

test("viewer role cannot rename an existing country or alter its index", async () => {
  const activeUid = await createAdmin();
  const viewerUid = await createAdmin("viewer", true);
  const originalName = `Viewer-Rename-Original-${randomUUID()}`;
  const replacementName = `Viewer-Rename-New-${randomUUID()}`;
  const created = await saveCountry(activeUid, originalName);
  const originalIndexId = countryIndexId(originalName);
  const replacementIndexId = countryIndexId(replacementName);

  await assert.rejects(
    () => saveCountry(viewerUid, replacementName, created.locationId),
    (error) => error && error.code === "permission-denied",
  );

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const originalIndex = await db.doc(`service_location_name_indexes/${originalIndexId}`).get();
  const replacementIndex = await db.doc(`service_location_name_indexes/${replacementIndexId}`).get();

  assert.equal(country.get("name"), originalName);
  assert.equal(originalIndex.exists, true);
  assert.equal(originalIndex.get("documentId"), created.locationId);
  assert.equal(replacementIndex.exists, false);
});

test("missing admin profile cannot create a country or its name index", async () => {
  const uid = `missing-admin-${randomUUID()}`;
  const name = `Missing-Admin-Create-${randomUUID()}`;
  const indexId = countryIndexId(name);

  await assert.rejects(
    () => saveCountry(uid, name),
    (error) => error && error.code === "permission-denied",
  );

  const matching = await db.collection("service_countries")
    .where("name", "==", name).get();
  const index = await db.doc(
    `service_location_name_indexes/${indexId}`,
  ).get();

  assert.equal(matching.empty, true);
  assert.equal(index.exists, false);
});

test("missing admin profile cannot rename a country or alter its index", async () => {
  const activeUid = await createAdmin();
  const missingUid = `missing-admin-${randomUUID()}`;
  const originalName = `Missing-Admin-Rename-Original-${randomUUID()}`;
  const replacementName = `Missing-Admin-Rename-New-${randomUUID()}`;
  const created = await saveCountry(activeUid, originalName);
  const originalIndexId = countryIndexId(originalName);
  const replacementIndexId = countryIndexId(replacementName);

  await assert.rejects(
    () => saveCountry(missingUid, replacementName, created.locationId),
    (error) => error && error.code === "permission-denied",
  );

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const originalIndex = await db.doc(
    `service_location_name_indexes/${originalIndexId}`,
  ).get();
  const replacementIndex = await db.doc(
    `service_location_name_indexes/${replacementIndexId}`,
  ).get();

  assert.equal(country.get("name"), originalName);
  assert.equal(originalIndex.exists, true);
  assert.equal(originalIndex.get("documentId"), created.locationId);
  assert.equal(replacementIndex.exists, false);
});

test("viewer role cannot change an existing country's code", async () => {
  const activeUid = await createAdmin();
  const viewerUid = await createAdmin("viewer", true);
  const name = `Viewer-Code-Guard-${randomUUID()}`;
  const created = await saveCountry(activeUid, name);
  const indexId = countryIndexId(name);

  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(viewerUid, {
      locationType: "country",
      locationId: created.locationId,
      payload: { name, code: "XX" },
    })),
    (error) => error && error.code === "permission-denied",
  );

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const index = await db.doc(
    `service_location_name_indexes/${indexId}`,
  ).get();

  assert.equal(country.get("name"), name);
  assert.equal(country.get("code"), "IN");
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), created.locationId);
});

test("active super_admin can create a country and its name index", async () => {
  const superAdminUid = await createAdmin("super_admin", true);
  const name = `Super-Admin-Create-${randomUUID()}`;
  const indexId = countryIndexId(name);

  const result = await saveCountry(superAdminUid, name);
  const country = await db.doc(`service_countries/${result.locationId}`).get();
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(result.ok, true);
  assert.equal(country.exists, true);
  assert.equal(country.get("name"), name);
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), result.locationId);
  assert.equal(index.get("collectionPath"), "service_countries");
});
test("inactive admin cannot change an existing country's code", async () => {
  const activeUid = await createAdmin();
  const inactiveUid = await createAdmin("admin", false);
  const name = `Inactive-Code-Guard-${randomUUID()}`;
  const created = await saveCountry(activeUid, name);
  const indexId = countryIndexId(name);

  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(inactiveUid, {
      locationType: "country",
      locationId: created.locationId,
      payload: { name, code: "XX" },
    })),
    (error) => error && error.code === "permission-denied",
  );

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const index = await db.doc(
    `service_location_name_indexes/${indexId}`,
  ).get();

  assert.equal(country.get("name"), name);
  assert.equal(country.get("code"), "IN");
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), created.locationId);
});

test("inactive admin cannot rename an existing country or alter its index", async () => {
  const activeUid = await createAdmin();
  const inactiveUid = await createAdmin("admin", false);
  const originalName = `Inactive-Rename-Original-${randomUUID()}`;
  const replacementName = `Inactive-Rename-New-${randomUUID()}`;
  const created = await saveCountry(activeUid, originalName);
  const originalIndexId = countryIndexId(originalName);
  const replacementIndexId = countryIndexId(replacementName);

  await assert.rejects(
    () => saveCountry(inactiveUid, replacementName, created.locationId),
    (error) => error && error.code === "permission-denied",
  );

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const originalIndex = await db.doc(`service_location_name_indexes/${originalIndexId}`).get();
  const replacementIndex = await db.doc(`service_location_name_indexes/${replacementIndexId}`).get();

  assert.equal(country.get("name"), originalName);
  assert.equal(originalIndex.exists, true);
  assert.equal(originalIndex.get("documentId"), created.locationId);
  assert.equal(replacementIndex.exists, false);
});

test("callable rejects invalid payloads before writing a location", async () => {
  const uid = await createAdmin();
  const name = `Invalid-${randomUUID()}`;
  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(uid, {
      locationType: "country",
      payload: { name, code: "IN", isActive: true },
    })),
    (error) => error && error.code === "invalid-argument",
  );
  const indexId = countryIndexId(name);
  assert.equal((await db.doc(`service_location_name_indexes/${indexId}`).get()).exists, false);
});

test("callable cannot change a country's activation flag during an update", async () => {
  const uid = await createAdmin();
  const name = `Activation-Guard-${randomUUID()}`;
  const created = await saveCountry(uid, name);
  const indexId = countryIndexId(name);

  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(uid, {
      locationType: "country",
      locationId: created.locationId,
      payload: { name, code: "IN", isActive: true },
    })),
    (error) => error && error.code === "invalid-argument",
  );

  const location = await db.doc(`service_countries/${created.locationId}`).get();
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(location.exists, true);
  assert.equal(location.get("isActive"), false);
  assert.equal(location.get("name"), name);
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), created.locationId);
});

test("callable creates an inactive country and its name index atomically", async () => {
  const uid = await createAdmin();
  const name = `Callable-${randomUUID()}`;
  const result = await saveCountry(uid, name);
  const location = await db.doc(`service_countries/${result.locationId}`).get();
  const indexId = countryIndexId(name);
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(result.ok, true);
  assert.equal(result.locationType, "country");
  assert.equal(location.exists, true);
  assert.equal(location.get("name"), name);
  assert.equal(location.get("isActive"), false);
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), result.locationId);
  assert.equal(index.get("collectionPath"), "service_countries");
});

test("callable rejects duplicate names and removes the old index on rename", async () => {
  const uid = await createAdmin();
  const originalName = `Original-${randomUUID()}`;
  const duplicateName = `Duplicate-${randomUUID()}`;
  const first = await saveCountry(uid, originalName);
  const second = await saveCountry(uid, duplicateName);

  await assert.rejects(
    () => saveCountry(uid, originalName),
    (error) => error && error.code === "already-exists",
  );

  const renamed = `Renamed-${randomUUID()}`;
  const renameResult = await saveCountry(uid, renamed, first.locationId);
  const oldIndex = await db.doc(
    `service_location_name_indexes/${countryIndexId(originalName)}`,
  ).get();
  const newIndex = await db.doc(
    `service_location_name_indexes/${countryIndexId(renamed)}`,
  ).get();
  const renamedLocation = await db.doc(`service_countries/${first.locationId}`).get();

  assert.equal(renameResult.locationId, first.locationId);
  assert.equal(oldIndex.exists, false);
  assert.equal(newIndex.exists, true);
  assert.equal(newIndex.get("documentId"), first.locationId);
  assert.equal(renamedLocation.get("name"), renamed);
  assert.equal(renamedLocation.get("isActive"), false);

  // Keep the second record referenced until cleanup; this assertion documents
  // that the duplicate-name failure did not overwrite the existing index.
  const duplicateIndex = await db.doc(
    `service_location_name_indexes/${countryIndexId(duplicateName)}`,
  ).get();
  assert.equal(duplicateIndex.get("documentId"), second.locationId);
});

test.after(async () => {
  const deletes = [];
  for (const uid of createdAdmins) deletes.push(db.doc(`admin_users/${uid}`).delete());
  for (const id of createdCountries) deletes.push(db.doc(`service_countries/${id}`).delete());
  for (const id of createdIndexes) deletes.push(db.doc(`service_location_name_indexes/${id}`).delete());
  await Promise.all(deletes);
});
