const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
} = require("firebase/auth");
const { getFirestore } = require("firebase-admin/firestore");
require("../lib/index"); // initialize Admin SDK against the emulator project

const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "demo-dojo-rules-tests";
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authHost = process.env.AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const db = getFirestore();

function callableUrl() {
  return `http://${functionsHost}/${projectId}/asia-south1/saveServiceLocationWithNameIndex`;
}

async function callSave(token, payload) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(callableUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: { locationType: "state", payload },
    }),
  });
  const body = await response.json();
  return { response, body };
}

async function createEmulatorUser(suffix) {
  const app = initializeApp(
    { projectId, apiKey: "fake-api-key" },
    `service-location-callable-${suffix}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(
    auth,
    `service-location-${suffix}@example.test`,
    `T3st-${suffix}!`,
  );
  return { app, auth, user: credential.user, token: await credential.user.getIdToken() };
}

test("saveServiceLocationWithNameIndex enforces admin auth, persists inactive state, and rejects duplicate", async (t) => {
  const suffix = randomUUID().replace(/-/g, "");
  const countryId = `e2e_country_${suffix}`;
  const admin = await createEmulatorUser(suffix);
  const adminRef = db.doc(`admin_users/${admin.user.uid}`);
  const countryRef = db.doc(`service_countries/${countryId}`);
  const createdLocationIds = [];

  t.after(async () => {
    for (const id of createdLocationIds) {
      await db.doc(`service_states/${id}`).delete().catch(() => {});
      const indexes = await db.collection("service_location_name_indexes")
        .where("documentId", "==", id).get().catch(() => null);
      if (indexes) {
        for (const doc of indexes.docs) await doc.ref.delete().catch(() => {});
      }
    }
    await adminRef.delete().catch(() => {});
    await countryRef.delete().catch(() => {});
    await deleteUser(admin.user).catch(() => {});
    await deleteApp(admin.app).catch(() => {});
  });

  await countryRef.set({ name: "India", code: "IN", isActive: true });
  await adminRef.set({ role: "super_admin", isActive: true });

  const stateName = `E2E State ${suffix}`;
  const payload = { countryId, name: stateName };

  const unauthenticated = await callSave(null, payload);
  assert.equal(unauthenticated.response.ok, false, "unauthenticated calls must be rejected");

  const saved = await callSave(admin.token, payload);
  assert.equal(saved.response.ok, true, JSON.stringify(saved.body));
  const result = saved.body.data ?? saved.body.result;
  assert.equal(result?.ok, true);
  const locationId = result.locationId;
  assert.ok(locationId, "callable should return the persisted location ID");
  createdLocationIds.push(locationId);

  const stored = await db.doc(`service_states/${locationId}`).get();
  assert.equal(stored.exists, true, "saved state must be readable from emulator Firestore");
  assert.equal(stored.get("name"), stateName);
  assert.equal(stored.get("countryId"), countryId);
  assert.equal(stored.get("isActive"), false, "new state must remain inactive");

  const duplicate = await callSave(admin.token, payload);
  assert.equal(duplicate.response.ok, false, "duplicate names under the same parent must be rejected");

  await adminRef.delete();
  const missingAdmin = await callSave(admin.token, {
    countryId,
    name: `Missing Admin ${suffix}`,
  });
  assert.equal(missingAdmin.response.ok, false, "a signed-in user without an admin record must be rejected");

  await adminRef.set({ role: "super_admin", isActive: false });
  const inactiveAdmin = await callSave(admin.token, {
    countryId,
    name: `Inactive Admin ${suffix}`,
  });
  assert.equal(inactiveAdmin.response.ok, false, "inactive admins must be rejected");
});
