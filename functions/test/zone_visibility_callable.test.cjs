const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const {
  initializeApp: initializeAdminApp,
  deleteApp: deleteAdminApp,
} = require("firebase-admin/app");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PASSWORD = "synthetic-zone-visibility-test-password";
const REGION = "asia-south1";
const actors = [
  { uid: "test-visibility-founder", email: "test-visibility-founder@example.test" },
  { uid: "test-visibility-founder-inactive", email: "test-visibility-founder-inactive@example.test" },
  { uid: "test-visibility-central", email: "test-visibility-central@example.test" },
  { uid: "test-visibility-central-inactive", email: "test-visibility-central-inactive@example.test" },
  { uid: "test-visibility-manager", email: "test-visibility-manager@example.test" },
  { uid: "test-visibility-supervisor", email: "test-visibility-supervisor@example.test" },
  { uid: "test-visibility-walker", email: "test-visibility-walker@example.test" },
  { uid: "test-visibility-reviewer", email: "test-visibility-reviewer@example.test" },
  { uid: "test-visibility-submitter", email: "test-visibility-submitter@example.test" },
  { uid: "test-visibility-customer", email: "test-visibility-customer@example.test" },
  { uid: "test-visibility-legacy-super-admin", email: "test-visibility-legacy-super-admin@example.test" },
  { uid: "test-visibility-claims-spoof", email: "test-visibility-claims-spoof@example.test" },
];
const docsToClean = [
  "service_zones/zone-a",
  "service_zones/zone-a2",
  "service_zones/zone-b",
  "service_zones/zone-stale",
  "service_location_boundaries/boundary-a",
  "service_location_boundaries/boundary-a2",
  "service_location_boundaries/boundary-b",
  "service_location_boundaries/boundary-own",
  "service_location_boundaries/boundary-reviewer-own",
  "founder_users/test-visibility-founder",
  "founder_users/test-visibility-founder-inactive",
  "admin_users/test-visibility-central",
  "admin_users/test-visibility-central-inactive",
  "admin_users/test-visibility-manager",
  "admin_users/test-visibility-supervisor",
  "admin_users/test-visibility-reviewer",
  "admin_users/test-visibility-legacy-super-admin",
  "admin_users/test-visibility-claims-spoof",
  "admin_scope_assignments/manager-city-a",
  "admin_scope_assignments/supervisor-zone-a",
  "walker_zone_assignments/walker-zone-a",
  "zone_boundary_review_assignments/reviewer-boundary-a",
  "zone_boundary_review_assignments/reviewer-boundary-own",
  "walkers/test-visibility-walker",
];
let adminApp;
let adminAuth;
let db;
const clients = new Map();

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires a Firebase demo-* project.");
  assert.ok(AUTH_HOST, "Auth Emulator host is required.");
  assert.ok(FIRESTORE_HOST, "Firestore Emulator host is required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production project is forbidden.");
}

async function callAs(uid, functionName, payload) {
  const client = clients.get(uid);
  assert.ok(client, `Missing synthetic client for ${uid}`);
  const fn = httpsCallable(client.functions, functionName);
  return fn(payload);
}

async function expectPermissionDenied(uid, functionName, payload) {
  await assert.rejects(
    callAs(uid, functionName, payload),
    error => error && error.code === "functions/permission-denied",
    `Expected ${functionName} to deny ${uid}`,
  );
}

function zoneIds(response) {
  assert.ok(response && response.data && Array.isArray(response.data.zones),
    "listVisibleServiceZones must return data.zones[]");
  return response.data.zones.map(zone => zone.zoneId).sort();
}

test.before(async () => {
  assertEmulatorIsolation();
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `zone-visibility-callables-${process.pid}`);
  adminAuth = getAdminAuth(adminApp);
  db = getFirestore(adminApp);

  for (const actor of actors) {
    try {
      await adminAuth.deleteUser(actor.uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    await adminAuth.createUser({ uid: actor.uid, email: actor.email, password: PASSWORD, emailVerified: true });
  }
  await adminAuth.setCustomUserClaims("test-visibility-claims-spoof", { isFounder: true, role: "central_admin" });

  const fixture = {
    "service_zones/zone-a": { schemaVersion: 1, zoneId: "zone-a", countryId: "india", stateId: "state-a", districtId: "district-a", cityId: "city-a", name: "Synthetic Zone A", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: "boundary-a", verifiedBoundaryRevision: 1, boundaryHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "service_zones/zone-a2": { schemaVersion: 1, zoneId: "zone-a2", countryId: "india", stateId: "state-a", districtId: "district-a", cityId: "city-a", name: "Synthetic Zone A2", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: "boundary-a2", verifiedBoundaryRevision: 1, boundaryHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "service_zones/zone-b": { schemaVersion: 1, zoneId: "zone-b", countryId: "india", stateId: "state-a", districtId: "district-b", cityId: "city-b", name: "Synthetic Zone B", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: "boundary-b", verifiedBoundaryRevision: 1, boundaryHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
    "service_zones/zone-stale": { schemaVersion: 1, zoneId: "zone-stale", countryId: "india", stateId: "state-a", districtId: "district-c", cityId: "city-c", name: "Synthetic Stale Zone", status: "active", isServiceActive: true, revision: 2, verifiedBoundaryId: "boundary-a", verifiedBoundaryRevision: 2, boundaryHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "service_location_boundaries/boundary-a": {
      locationType: "zone", locationId: "zone-a", zoneRevision: 1, zoneId: "zone-a",
      revision: 1, verificationStatus: "verified", geometryHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }],
      submitted: true, submittedBy: "test-visibility-central",
    },
    "service_location_boundaries/boundary-a2": {
      locationType: "zone", locationId: "zone-a2", zoneRevision: 1, zoneId: "zone-a2",
      revision: 1, verificationStatus: "verified", geometryHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      points: [{ lat: 28.52, lng: 77.32 }, { lat: 28.62, lng: 77.32 }, { lat: 28.62, lng: 77.42 }],
      submitted: true, submittedBy: "test-visibility-central",
    },
    "service_location_boundaries/boundary-b": {
      locationType: "zone", locationId: "zone-b", zoneRevision: 1, zoneId: "zone-b",
      revision: 1, verificationStatus: "verified", geometryHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      points: [{ lat: 28.53, lng: 77.33 }, { lat: 28.63, lng: 77.33 }, { lat: 28.63, lng: 77.43 }],
      submitted: true, submittedBy: "test-visibility-central",
    },
    "service_location_boundaries/boundary-reviewer-own": {
      locationType: "zone", locationId: "zone-a", zoneRevision: 1, zoneId: "zone-a",
      revision: 1, verificationStatus: "pending",
      points: [{ lat: 28.54, lng: 77.34 }, { lat: 28.64, lng: 77.34 }, { lat: 28.64, lng: 77.44 }],
      submitted: true, createdBy: "test-visibility-reviewer", submittedBy: "test-visibility-reviewer",
    },
    "service_location_boundaries/boundary-own": {
      locationType: "zone", locationId: "zone-a", zoneRevision: 1, zoneId: "zone-a",
      revision: 1, verificationStatus: "draft",
      points: [{ lat: 28.51, lng: 77.31 }, { lat: 28.61, lng: 77.31 }, { lat: 28.61, lng: 77.41 }],
      submitted: false, createdBy: "test-visibility-submitter",
    },
    "founder_users/test-visibility-founder": { authorityType: "founder_ceo", isActive: true, permissions: { zoneGeometryReadAll: true }, fixtureOnly: true },
    "founder_users/test-visibility-founder-inactive": { authorityType: "founder_ceo", isActive: false, fixtureOnly: true },
    "admin_users/test-visibility-central": { role: "central_admin", isActive: true, permissions: { zoneGeometryReadAll: true }, fixtureOnly: true },
    "admin_users/test-visibility-central-inactive": { role: "central_admin", isActive: false, permissions: { zoneGeometryReadAll: true }, fixtureOnly: true },
    "admin_users/test-visibility-manager": { role: "city_manager", isActive: true, fixtureOnly: true },
    "admin_users/test-visibility-supervisor": { role: "zone_supervisor", isActive: true, fixtureOnly: true },
    "admin_users/test-visibility-reviewer": { role: "admin", isActive: true, permissions: { zoneBoundaryReview: true }, fixtureOnly: true },
    "admin_users/test-visibility-legacy-super-admin": { role: "super_admin", isActive: true, fixtureOnly: true },
    "admin_users/test-visibility-claims-spoof": { role: "support", isActive: true, fixtureOnly: true },
    "admin_scope_assignments/manager-city-a": { adminUid: "test-visibility-manager", role: "city_manager", scopeType: "city", scopeId: "city-a", isActive: true },
    "admin_scope_assignments/supervisor-zone-a": { adminUid: "test-visibility-supervisor", role: "zone_supervisor", scopeType: "zone", scopeId: "zone-a", isActive: true },
    "walker_zone_assignments/walker-zone-a": { walkerUid: "test-visibility-walker", zoneId: "zone-a", status: "active", effectiveFrom: new Date("2026-01-01T00:00:00Z") },
    "zone_boundary_review_assignments/reviewer-boundary-a": { reviewerUid: "test-visibility-reviewer", zoneId: "zone-a", boundaryId: "boundary-a", status: "assigned" },
    "zone_boundary_review_assignments/reviewer-boundary-own": { reviewerUid: "test-visibility-reviewer", zoneId: "zone-a", boundaryId: "boundary-reviewer-own", status: "assigned" },
    "walkers/test-visibility-walker": {
      isActive: true, isApproved: true,
      zoneName: "Synthetic Zone B", zoneNames: ["Synthetic Zone B"], zones: ["legacy-zone-b"],
    },
  };
  for (const [path, value] of Object.entries(fixture)) await db.doc(path).set({ ...value, fixtureOnly: true });

  for (const actor of actors) {
    const app = initializeApp({
      projectId: PROJECT_ID,
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
    }, `zone-vis-client-${actor.uid}-${process.pid}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    await signInWithEmailAndPassword(auth, actor.email, PASSWORD);
    const functions = getFunctions(app, REGION);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    clients.set(actor.uid, { app, auth, functions });
  }
});

test("Founder reads all Zones and an arbitrary Zone boundary", async () => {
  const result = await callAs("test-visibility-founder", "listVisibleServiceZones", { pageSize: 100 });
  assert.deepEqual(zoneIds(result), ["zone-a", "zone-a2", "zone-b", "zone-stale"]);
  assert.equal(result.data.zones[0].points, undefined, "Zone list metadata must not include polygon coordinates.");
  const boundary = await callAs("test-visibility-founder", "getVisibleServiceZoneBoundary", { zoneId: "zone-b" });
  assert.equal(boundary.data.zoneId, "zone-b");
  const audit = await db.collection("service_zone_audit").where("actorUid", "==", "test-visibility-founder").get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].get("points"), undefined, "Geometry access audit must not store polygon coordinates.");
});

test("inactive and unregistered Founder identities are denied", async () => {
  await expectPermissionDenied("test-visibility-founder-inactive", "listVisibleServiceZones", { pageSize: 100 });
  await expectPermissionDenied("test-visibility-central-inactive", "listVisibleServiceZones", { pageSize: 100 });
  await expectPermissionDenied("test-visibility-customer", "listVisibleServiceZones", { pageSize: 100 });
});

test("Central Admin requires active membership and explicit global geometry permission", async () => {
  const result = await callAs("test-visibility-central", "listVisibleServiceZones", { pageSize: 100 });
  assert.deepEqual(zoneIds(result), ["zone-a", "zone-a2", "zone-b"]);
  await expectPermissionDenied("test-visibility-legacy-super-admin", "listVisibleServiceZones", { pageSize: 100 });
  await expectPermissionDenied("test-visibility-claims-spoof", "listVisibleServiceZones", { pageSize: 100 });
  await db.doc("admin_users/test-visibility-central").update({ permissions: { zoneGeometryReadAll: false } });
  await expectPermissionDenied("test-visibility-central", "listVisibleServiceZones", { pageSize: 100 });
});

test("City Manager sees assigned City Zones only and cannot widen scope in payload", async () => {
  const result = await callAs("test-visibility-manager", "listVisibleServiceZones", { pageSize: 100, cityId: "city-b" });
  assert.deepEqual(zoneIds(result), ["zone-a", "zone-a2"]);
  await callAs("test-visibility-manager", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await expectPermissionDenied("test-visibility-manager", "getVisibleServiceZoneBoundary", { zoneId: "zone-b" });
});

test("Supervisor sees only the exact assigned Zone", async () => {
  const result = await callAs("test-visibility-supervisor", "listVisibleServiceZones", { pageSize: 100 });
  assert.deepEqual(zoneIds(result), ["zone-a"]);
  await callAs("test-visibility-supervisor", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await expectPermissionDenied("test-visibility-supervisor", "getVisibleServiceZoneBoundary", { zoneId: "zone-a2" });
});

test("Walker assignment, not editable onboarding preference, determines Zone visibility", async () => {
  const result = await callAs("test-visibility-walker", "listVisibleServiceZones", { pageSize: 100 });
  assert.deepEqual(zoneIds(result), ["zone-a"]);
  await callAs("test-visibility-walker", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await expectPermissionDenied("test-visibility-walker", "getVisibleServiceZoneBoundary", { zoneId: "zone-b" });
});

test("Reviewer sees only assigned review boundary and cannot list all Zones", async () => {
  await callAs("test-visibility-reviewer", "getVisibleServiceZoneBoundary", { boundaryId: "boundary-a" });
  const audit = await db.collection("service_zone_audit").where("actorUid", "==", "test-visibility-reviewer").get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].get("action"), "assigned_review_boundary_read");
  await expectPermissionDenied("test-visibility-reviewer", "getVisibleServiceZoneBoundary", { boundaryId: "boundary-own" });
  await expectPermissionDenied("test-visibility-reviewer", "getVisibleServiceZoneBoundary", { boundaryId: "boundary-reviewer-own" });
  await expectPermissionDenied("test-visibility-reviewer", "listVisibleServiceZones", { pageSize: 100 });
});

test("Draft submitter sees own draft only and cannot fetch another boundary", async () => {
  await callAs("test-visibility-submitter", "getVisibleServiceZoneBoundary", { boundaryId: "boundary-own" });
  const audit = await db.collection("service_zone_audit").where("actorUid", "==", "test-visibility-submitter").get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].get("action"), "own_draft_boundary_read");
  await expectPermissionDenied("test-visibility-submitter", "getVisibleServiceZoneBoundary", { boundaryId: "boundary-a" });
  await expectPermissionDenied("test-visibility-submitter", "listVisibleServiceZones", { pageSize: 100 });
});

test("stale verified boundary revision/hash is rejected even for Founder", async () => {
  await assert.rejects(
    callAs("test-visibility-founder", "getVisibleServiceZoneBoundary", { zoneId: "zone-stale" }),
    error => error && error.code === "functions/failed-precondition",
  );
});

test("Customer and legacy super_admin receive no raw Zone geometry or audit event", async () => {
  await expectPermissionDenied("test-visibility-customer", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await expectPermissionDenied("test-visibility-legacy-super-admin", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  const audit = await db.collection("service_zone_audit").where("actorUid", "==", "test-visibility-customer").get();
  assert.equal(audit.size, 0, "Denied geometry requests must not create access audit events.");
});

test("revocation and reassignment invalidate subsequent callable reads", async () => {
  await callAs("test-visibility-supervisor", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await db.doc("admin_scope_assignments/supervisor-zone-a").update({ isActive: false, revokedAt: new Date() });
  await expectPermissionDenied("test-visibility-supervisor", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await db.doc("admin_scope_assignments/supervisor-zone-a").update({ isActive: true, revokedAt: null, scopeId: "zone-b" });
  await expectPermissionDenied("test-visibility-supervisor", "getVisibleServiceZoneBoundary", { zoneId: "zone-a" });
  await callAs("test-visibility-supervisor", "getVisibleServiceZoneBoundary", { zoneId: "zone-b" });
});

test.after(async () => {
  for (const client of clients.values()) {
    await signOut(client.auth).catch(() => {});
    await deleteApp(client.app).catch(() => {});
  }
  if (db) {
    for (const path of docsToClean) await db.doc(path).delete().catch(() => {});
    const auditSnapshot = await db.collection("service_zone_audit")
      .where("actorUid", "in", actors.map(actor => actor.uid)).get().catch(() => null);
    if (auditSnapshot) {
      const batch = db.batch();
      auditSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit().catch(() => {});
    }
  }
  if (adminAuth) for (const actor of actors) await adminAuth.deleteUser(actor.uid).catch(() => {});
  if (adminApp) await deleteAdminApp(adminApp);
});
