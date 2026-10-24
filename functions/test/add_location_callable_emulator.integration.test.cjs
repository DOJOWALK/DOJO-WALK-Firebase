const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");

// This test intentionally exercises the real callable HTTP endpoint. It must
// never run against a deployed Firebase project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Add Location callable integration test requires Firebase Emulators; refusing to run outside emulator tests.");
}

const projectId = process.env.GCLOUD_PROJECT || "demo-dojo-rules-tests";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const callableUrl = `http://${functionsHost}/${projectId}/asia-south1/saveServiceLocationWithNameIndex`;
initializeApp({ projectId });
const db = getFirestore();

async function callSave(idToken, data) {
  return fetch(callableUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
}

async function createEmulatorUser() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `add-location-it-${suffix}@example.test`,
        password: `Test-${suffix}-Aa9!`,
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json();
  assert.equal(response.ok, true, `Auth Emulator sign-up failed: ${JSON.stringify(body)}`);
  assert.equal(typeof body.localId, "string");
  assert.equal(typeof body.idToken, "string");
  return body;
}

test("Add Location callable: authenticated save, Firestore read-back, and duplicate rejection", async (t) => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const countryId = `it-country-${suffix}`;
  const stateId = `it-state-${suffix}`;
  const duplicateStateId = `it-state-duplicate-${suffix}`;
  const countryName = `Add Location Country ${suffix}`;
  const stateName = `Add Location State ${suffix}`;
  const countryIndexId = serviceLocationNameIndexId("service_countries", [], countryName);
  const stateIndexId = serviceLocationNameIndexId("service_states", [countryId], stateName);
  let uid;

  t.after(async () => {
    const paths = [
      `service_countries/${countryId}`,
      `service_states/${stateId}`,
      `service_states/${duplicateStateId}`,
      `service_location_name_indexes/${countryIndexId}`,
      `service_location_name_indexes/${stateIndexId}`,
    ];
    if (uid) paths.push(`admin_users/${uid}`);
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    // The Auth Emulator is ephemeral for this workflow; its user disappears
    // when the emulator process exits.
  });

  const unauthenticated = await callSave(null, {
    locationType: "country",
    locationId: countryId,
    payload: { name: countryName, code: "IT" },
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error?.status, "UNAUTHENTICATED");

  const user = await createEmulatorUser();
  uid = user.localId;
  // This seed uses the Admin SDK against the Firestore Emulator only. The
  // callable still receives and verifies a real Auth Emulator ID token.
  const adminRef = db.doc(`admin_users/${uid}`);
  await adminRef.set({ role: "super_admin", isActive: true });

  // Explicit negative authorization cases: inactive admins and active
  // non-admin roles must not be able to create service locations.
  await adminRef.set({ role: "super_admin", isActive: false });
  const inactiveAdminResponse = await callSave(user.idToken, {
    locationType: "country",
    locationId: countryId,
    payload: { name: countryName, code: "IT" },
  });
  const inactiveAdminBody = await inactiveAdminResponse.json();
  assert.equal(inactiveAdminBody.error?.status, "PERMISSION_DENIED", JSON.stringify(inactiveAdminBody));
  assert.equal((await db.doc(`service_countries/${countryId}`).get()).exists, false,
    "Inactive admin must not create a Country");

  await adminRef.set({ role: "customer", isActive: true });
  const wrongRoleResponse = await callSave(user.idToken, {
    locationType: "country",
    locationId: countryId,
    payload: { name: countryName, code: "IT" },
  });
  const wrongRoleBody = await wrongRoleResponse.json();
  assert.equal(wrongRoleBody.error?.status, "PERMISSION_DENIED", JSON.stringify(wrongRoleBody));
  assert.equal((await db.doc(`service_countries/${countryId}`).get()).exists, false,
    "An active non-admin role must not create a Country");

  await adminRef.set({ role: "super_admin", isActive: true });

  const countryResponse = await callSave(user.idToken, {
    locationType: "country",
    locationId: countryId,
    payload: { name: countryName, code: "IT" },
  });
  const countryBody = await countryResponse.json();
  assert.equal(countryResponse.status, 200, JSON.stringify(countryBody));
  assert.equal(countryBody.result?.locationId, countryId);

  const countrySnapshot = await db.doc(`service_countries/${countryId}`).get();
  assert.equal(countrySnapshot.exists, true, "Country should be readable after callable save");
  assert.equal(countrySnapshot.get("name"), countryName);
  assert.equal(countrySnapshot.get("code"), "IT");
  assert.equal(countrySnapshot.get("isActive"), false, "New locations must remain inactive");
  const countryIndexSnapshot = await db.doc(`service_location_name_indexes/${countryIndexId}`).get();
  assert.equal(countryIndexSnapshot.exists, true);
  assert.equal(countryIndexSnapshot.get("documentId"), countryId);

  const stateResponse = await callSave(user.idToken, {
    locationType: "state",
    locationId: stateId,
    payload: { countryId, name: stateName },
  });
  const stateBody = await stateResponse.json();
  assert.equal(stateResponse.status, 200, JSON.stringify(stateBody));
  assert.equal(stateBody.result?.locationId, stateId);

  const stateSnapshot = await db.doc(`service_states/${stateId}`).get();
  assert.equal(stateSnapshot.exists, true, "State should be readable after callable save");
  assert.equal(stateSnapshot.get("name"), stateName);
  assert.equal(stateSnapshot.get("countryId"), countryId);
  assert.equal(stateSnapshot.get("isActive"), false, "New States must remain inactive");
  const stateIndexSnapshot = await db.doc(`service_location_name_indexes/${stateIndexId}`).get();
  assert.equal(stateIndexSnapshot.exists, true);
  assert.equal(stateIndexSnapshot.get("documentId"), stateId);

  const duplicateResponse = await callSave(user.idToken, {
    locationType: "state",
    locationId: duplicateStateId,
    payload: { countryId, name: stateName },
  });
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateBody.error?.status, "ALREADY_EXISTS", JSON.stringify(duplicateBody));
  assert.equal((await db.doc(`service_states/${duplicateStateId}`).get()).exists, false,
    "Duplicate save must not create a second State document");
});
