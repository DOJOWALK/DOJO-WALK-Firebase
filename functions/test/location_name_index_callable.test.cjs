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

test("country rename is case-insensitive and whitespace-normalized for duplicate detection", async () => {
  const adminUid = await createAdmin("admin", true);
  const existingName = `Normalized-${randomUUID()}`;
  const conflictingName = `  ${existingName.toUpperCase()}   `;
  const existing = await saveCountry(adminUid, existingName);
  const targetName = `Rename-Target-${randomUUID()}`;
  const target = await saveCountry(adminUid, targetName);
  const existingIndexId = countryIndexId(existingName);
  const targetIndexId = countryIndexId(targetName);

  await assert.rejects(
    () => saveCountry(adminUid, conflictingName, target.locationId),
    (error) => error && error.code === "already-exists",
  );

  const existingCountry = await db.doc(`service_countries/${existing.locationId}`).get();
  const targetCountry = await db.doc(`service_countries/${target.locationId}`).get();
  const existingIndex = await db.doc(`service_location_name_indexes/${existingIndexId}`).get();
  const targetIndex = await db.doc(`service_location_name_indexes/${targetIndexId}`).get();

  assert.equal(existingCountry.get("name"), existingName);
  assert.equal(targetCountry.get("name"), targetName);
  assert.equal(existingIndex.exists, true);
  assert.equal(existingIndex.get("documentId"), existing.locationId);
  assert.equal(targetIndex.exists, true);
  assert.equal(targetIndex.get("documentId"), target.locationId);
});
test("renaming a country to an existing name preserves both countries and indexes", async () => {
  const adminUid = await createAdmin("admin", true);
  const firstName = `Duplicate-Rename-First-${randomUUID()}`;
  const secondName = `Duplicate-Rename-Second-${randomUUID()}`;
  const first = await saveCountry(adminUid, firstName);
  const second = await saveCountry(adminUid, secondName);
  const firstIndexId = countryIndexId(firstName);
  const secondIndexId = countryIndexId(secondName);

  await assert.rejects(
    () => saveCountry(adminUid, secondName, first.locationId),
    (error) => error && error.code === "already-exists",
  );

  const firstCountry = await db.doc(`service_countries/${first.locationId}`).get();
  const secondCountry = await db.doc(`service_countries/${second.locationId}`).get();
  const firstIndex = await db.doc(`service_location_name_indexes/${firstIndexId}`).get();
  const secondIndex = await db.doc(`service_location_name_indexes/${secondIndexId}`).get();

  assert.equal(firstCountry.get("name"), firstName);
  assert.equal(secondCountry.get("name"), secondName);
  assert.equal(firstIndex.exists, true);
  assert.equal(firstIndex.get("documentId"), first.locationId);
  assert.equal(secondIndex.exists, true);
  assert.equal(secondIndex.get("documentId"), second.locationId);
});
test("active admin can rename a country and atomically move its name index", async () => {
  const adminUid = await createAdmin("admin", true);
  const originalName = `Admin-Rename-Original-${randomUUID()}`;
  const replacementName = `Admin-Rename-New-${randomUUID()}`;
  const created = await saveCountry(adminUid, originalName);
  const originalIndexId = countryIndexId(originalName);
  const replacementIndexId = countryIndexId(replacementName);

  const result = await saveCountry(adminUid, replacementName, created.locationId);
  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const originalIndex = await db.doc(`service_location_name_indexes/${originalIndexId}`).get();
  const replacementIndex = await db.doc(`service_location_name_indexes/${replacementIndexId}`).get();

  assert.equal(result.ok, true);
  assert.equal(result.locationId, created.locationId);
  assert.equal(country.get("name"), replacementName);
  assert.equal(originalIndex.exists, false);
  assert.equal(replacementIndex.exists, true);
  assert.equal(replacementIndex.get("documentId"), created.locationId);
  assert.equal(replacementIndex.get("collectionPath"), "service_countries");
});
test("active admin can change a country code without breaking its name index", async () => {
  const adminUid = await createAdmin("admin", true);
  const name = `Admin-Code-Update-${randomUUID()}`;
  const created = await saveCountry(adminUid, name);
  const indexId = countryIndexId(name);

  const result = await saveServiceLocationWithNameIndex.run(request(adminUid, {
    locationType: "country",
    locationId: created.locationId,
    payload: { name, code: "XX" },
  }));

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(result.ok, true);
  assert.equal(country.get("code"), "XX");
  assert.equal(country.get("name"), name);
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), created.locationId);
  assert.equal(index.get("collectionPath"), "service_countries");
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

test("country creation rejects case-insensitive and whitespace-normalized duplicates", async () => {
  const uid = await createAdmin();
  const existingName = `Create-Normalized-${randomUUID()}`;
  const existing = await saveCountry(uid, existingName);
  const duplicateName = `  ${existingName.toUpperCase()}   `;

  await assert.rejects(
    () => saveCountry(uid, duplicateName),
    (error) => error && error.code === "already-exists",
  );

  const indexId = countryIndexId(existingName);
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();
  const location = await db.doc(`service_countries/${existing.locationId}`).get();

  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), existing.locationId);
  assert.equal(index.get("name"), existingName.trim().toLowerCase());
  assert.equal(location.exists, true);
  assert.equal(location.get("name"), existingName);
});

test("renaming a country to its own normalized name preserves its name index", async () => {
  const uid = await createAdmin();
  const originalName = `Self-Normalized-${randomUUID()}`;
  const created = await saveCountry(uid, originalName);
  const indexId = countryIndexId(originalName);
  const equivalentName = `  ${originalName.toUpperCase()}   `;

  const renamed = await saveCountry(uid, equivalentName, created.locationId);
  const location = await db.doc(`service_countries/${created.locationId}`).get();
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(renamed.ok, true);
  assert.equal(renamed.locationId, created.locationId);
  assert.equal(location.exists, true);
  assert.equal(location.get("name"), originalName.toUpperCase());
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), created.locationId);
  assert.equal(index.get("name"), originalName.trim().toLowerCase());
});

test("country rename and code change update the location and name index together", async () => {
  const uid = await createAdmin();
  const originalName = `Combined-Original-${randomUUID()}`;
  const newName = `Combined-Renamed-${randomUUID()}`;
  const created = await saveCountry(uid, originalName);
  const oldIndexId = countryIndexId(originalName);
  const newIndexId = countryIndexId(newName);

  const result = await saveServiceLocationWithNameIndex.run(request(uid, {
    locationType: "country",
    locationId: created.locationId,
    payload: { name: newName, code: "GB" },
  }));

  const oldIndex = await db.doc(`service_location_name_indexes/${oldIndexId}`).get();
  const newIndex = await db.doc(`service_location_name_indexes/${newIndexId}`).get();
  const location = await db.doc(`service_countries/${created.locationId}`).get();

  assert.equal(result.ok, true);
  assert.equal(result.locationId, created.locationId);
  assert.equal(oldIndex.exists, false);
  assert.equal(newIndex.exists, true);
  assert.equal(newIndex.get("documentId"), created.locationId);
  assert.equal(newIndex.get("name"), newName.trim().toLowerCase());
  assert.equal(location.get("name"), newName);
  assert.equal(location.get("code"), "GB");
});

test("duplicate-name rename cannot partially apply a country code change", async () => {
  const uid = await createAdmin();
  const firstName = `Atomic-Duplicate-First-${randomUUID()}`;
  const secondName = `Atomic-Duplicate-Second-${randomUUID()}`;
  const first = await saveCountry(uid, firstName);
  const second = await saveCountry(uid, secondName);
  const firstIndexId = countryIndexId(firstName);
  const secondIndexId = countryIndexId(secondName);

  await assert.rejects(
    () => saveServiceLocationWithNameIndex.run(request(uid, {
      locationType: "country",
      locationId: first.locationId,
      payload: { name: secondName, code: "GB" },
    })),
    (error) => error && error.code === "already-exists",
  );

  const firstCountry = await db.doc(`service_countries/${first.locationId}`).get();
  const secondCountry = await db.doc(`service_countries/${second.locationId}`).get();
  const firstIndex = await db.doc(`service_location_name_indexes/${firstIndexId}`).get();
  const secondIndex = await db.doc(`service_location_name_indexes/${secondIndexId}`).get();

  assert.equal(firstCountry.get("name"), firstName);
  assert.equal(firstCountry.get("code"), "IN");
  assert.equal(secondCountry.get("name"), secondName);
  assert.equal(secondCountry.get("code"), "IN");
  assert.equal(firstIndex.exists, true);
  assert.equal(firstIndex.get("documentId"), first.locationId);
  assert.equal(secondIndex.exists, true);
  assert.equal(secondIndex.get("documentId"), second.locationId);
});

test("normalized self-rename can update country code without moving its index", async () => {
  const uid = await createAdmin();
  const originalName = `Self-Rename-Code-${randomUUID()}`;
  const created = await saveCountry(uid, originalName);
  const indexId = countryIndexId(originalName);
  const normalizedName = originalName.toUpperCase();

  const result = await saveServiceLocationWithNameIndex.run(request(uid, {
    locationType: "country",
    locationId: created.locationId,
    payload: { name: `  ${normalizedName}  `, code: "GB" },
  }));

  const country = await db.doc(`service_countries/${created.locationId}`).get();
  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();

  assert.equal(result.ok, true);
  assert.equal(result.locationId, created.locationId);
  assert.equal(country.get("name"), normalizedName);
  assert.equal(country.get("code"), "GB");
  assert.equal(index.exists, true);
  assert.equal(index.get("documentId"), created.locationId);
  assert.equal(index.get("name"), originalName.trim().toLowerCase().replace(/\\s+/g, " "));
});

test("blank country code update is rejected without changing saved data", async () => {\n  const uid = await createAdmin();\n  const name = `Blank-Code-${randomUUID()}`;\n  const created = await saveCountry(uid, name);\n  const indexId = countryIndexId(name);\n\n  await assert.rejects(\n    () => saveServiceLocationWithNameIndex.run(request(uid, {\n      locationType: "country",\n      locationId: created.locationId,\n      payload: { name, code: "   " },\n    })),\n    (error) => error && error.code === "invalid-argument",\n  );\n\n  const country = await db.doc(`service_countries/${created.locationId}`).get();\n  const index = await db.doc(`service_location_name_indexes/${indexId}`).get();\n  assert.equal(country.get("name"), name);\n  assert.equal(country.get("code"), "IN");\n  assert.equal(index.exists, true);\n  assert.equal(index.get("documentId"), created.locationId);\n  assert.equal(index.get("name"), name.trim().toLowerCase().replace(/\\s+/g, " "));\n});\ntest.after(async () => {
  const deletes = [];
  for (const uid of createdAdmins) deletes.push(db.doc(`admin_users/${uid}`).delete());
  for (const id of createdCountries) deletes.push(db.doc(`service_countries/${id}`).delete());
  for (const id of createdIndexes) deletes.push(db.doc(`service_location_name_indexes/${id}`).delete());
  await Promise.all(deletes);
});
