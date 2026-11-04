const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require("firebase-admin/app");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PASSWORD = "synthetic-zone-lifecycle-acceptance-password";
const REGION = "asia-south1";
const PREFIX = `zl-accept-${process.pid}`;
const actorRows = [
  ["founder", "founder"],
  ["central", "central"],
  ["central-no-review", "central-no-review"],
  ["reviewer-submitter", "reviewer-submitter"],
  ["manager", "manager"],
  ["legacy", "legacy"],
  ["customer", "customer"],
];
const uid = Object.fromEntries(actorRows.map(([key]) => [key, `${PREFIX}-${key}`]));
const clients = new Map();
const cleanupPaths = new Set();
let adminApp;
let adminAuth;
let db;

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires Firebase demo-* project.");
  assert.ok(AUTH_HOST && FIRESTORE_HOST, "Auth and Firestore Emulator hosts are required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production project is forbidden.");
}

function track(path) { cleanupPaths.add(path); return db.doc(path); }
async function seed(path, data) { await track(path).set({ ...data, fixtureOnly: true }); }

async function callAs(actor, name, payload) {
  const client = clients.get(actor);
  assert.ok(client, `Missing synthetic client for ${actor}`);
  return httpsCallable(client.functions, name)(payload);
}

async function expectCode(actor, name, payload, expected) {
  await assert.rejects(callAs(actor, name, payload), error =>
    error && error.code === `functions/${expected}`,
  `Expected ${name} to fail with ${expected} for ${actor}`);
}

async function assertZoneUnchanged(zoneId, expected) {
  const snap = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(snap.exists, true);
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(snap.get(field), value, `Unexpected mutation of ${zoneId}.${field}`);
}

test.before(async () => {
  assertEmulatorIsolation();
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `zone-lifecycle-acceptance-${process.pid}`);
  adminAuth = getAdminAuth(adminApp);
  db = getFirestore(adminApp);

  for (const [key, role] of actorRows) {
    const actorUid = uid[key];
    await adminAuth.deleteUser(actorUid).catch(error => {
      if (error.code !== "auth/user-not-found") throw error;
    });
    await adminAuth.createUser({ uid: actorUid, email: `${actorUid}@example.test`, password: PASSWORD, emailVerified: true });
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com` }, `zl-client-${key}-${process.pid}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    await signInWithEmailAndPassword(auth, `${actorUid}@example.test`, PASSWORD);
    const functions = getFunctions(app, REGION);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    clients.set(key, { app, auth, functions });
  }

  await seed(`founder_users/${uid.founder}`, { authorityType: "founder_ceo", isActive: true, permissions: { founderApproval: true } });
  await seed(`admin_users/${uid.central}`, { role: "central_admin", isActive: true, permissions: { zoneOperations: true, zoneGeometryReadAll: true, zoneEmergencySuspend: true } });
  await seed(`admin_users/${uid["central-no-review"]}`, { role: "central_admin", isActive: true, permissions: { zoneOperations: true } });
  await seed(`admin_users/${uid["reviewer-submitter"]}`, { role: "admin", isActive: true, permissions: { zoneBoundaryReview: true } });
  await seed(`admin_users/${uid.manager}`, { role: "city_manager", isActive: true });
  await seed(`admin_users/${uid.legacy}`, { role: "super_admin", isActive: true });
  await seed(`admin_users/${uid.customer}`, { role: "customer", isActive: true });

  await seed(`admin_scope_assignments/${PREFIX}-manager-city-a`, { adminUid: uid.manager, role: "city_manager", scopeType: "city", scopeId: `${PREFIX}-city-a`, isActive: true });
  await seed(`zone_boundary_review_assignments/${PREFIX}-reviewer-own`, { reviewerUid: uid["reviewer-submitter"], zoneId: `${PREFIX}-zone-self`, boundaryId: `${PREFIX}-boundary-self`, status: "assigned" });

  await seed(`service_zones/${PREFIX}-zone-self`, { schemaVersion: 1, zoneId: `${PREFIX}-zone-self`, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Self Review", normalizedName: "self review", workflowStatus: "boundary_review_pending", isServiceActive: false, revision: 2, currentBoundaryId: `${PREFIX}-boundary-self` });
  await seed(`service_location_boundaries/${PREFIX}-boundary-self`, { locationType: "zone", locationId: `${PREFIX}-zone-self`, zoneId: `${PREFIX}-zone-self`, zoneRevision: 2, revision: 1, points: [[77.3,28.5],[77.4,28.5],[77.4,28.6],[77.3,28.5]], sourceType: "manuallyDrawn", sourceName: "Synthetic fixture", sourceReference: "fixture:self", verificationStatus: "pending", submittedBy: uid["reviewer-submitter"] });

  const approvalZone = `${PREFIX}-zone-approval`;
  const approvalBoundary = `${PREFIX}-boundary-approval`;
  await seed(`service_zones/${approvalZone}`, { schemaVersion: 1, zoneId: approvalZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Approval Zone", normalizedName: "approval zone", workflowStatus: "founder_review_pending", isServiceActive: false, revision: 3, currentBoundaryId: approvalBoundary, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "a".repeat(64) });
  await seed(`service_location_boundaries/${approvalBoundary}`, { locationType: "zone", locationId: approvalZone, zoneId: approvalZone, zoneRevision: 3, revision: 1, points: [[77.3,28.5],[77.4,28.5],[77.4,28.6],[77.3,28.5]], sourceType: "governmentGis", sourceName: "Synthetic GIS", sourceReference: "fixture:approval", verificationStatus: "verified", geometryHash: "a".repeat(64), submittedBy: uid.central });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-current`, { zoneId: approvalZone, revision: 3, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "pending", requestedBy: uid.central });

  const legacyZone = `${PREFIX}-zone-legacy`;
  await seed(`service_zones/${legacyZone}`, { schemaVersion: 1, zoneId: legacyZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Legacy Zone", normalizedName: "legacy zone", workflowStatus: "approved", isServiceActive: false, revision: 4, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "a".repeat(64), approvedRevision: 4, approvedBoundaryId: approvalBoundary, approvedBoundaryHash: "a".repeat(64), approvedRequestId: `${PREFIX}-approval-legacy` });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-legacy`, { zoneId: legacyZone, revision: 4, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "approved", requestedBy: uid.central, decidedBy: uid.founder, decision: "approved" });

  const staleZone = `${PREFIX}-zone-stale`;
  await seed(`service_zones/${staleZone}`, { schemaVersion: 1, zoneId: staleZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Stale Zone", normalizedName: "stale zone", workflowStatus: "founder_review_pending", isServiceActive: false, revision: 8, currentBoundaryId: approvalBoundary, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 7, verifiedBoundaryHash: "b".repeat(64) });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-stale`, { zoneId: staleZone, revision: 7, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "pending", requestedBy: uid.central });

  for (const [zoneId, cityId] of [[`${PREFIX}-zone-city-a`, `${PREFIX}-city-a`], [`${PREFIX}-zone-city-b`, `${PREFIX}-city-b`]]) {
    await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, stateId: "state-test", districtId: "district-test", cityId, name: zoneId, workflowStatus: "active", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "a".repeat(64) });
  }

  const raceZone = `${PREFIX}-zone-race`;
  await seed(`service_zones/${raceZone}`, { schemaVersion: 1, zoneId: raceZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Race Zone", normalizedName: "race zone", workflowStatus: "approved", isServiceActive: false, revision: 5, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "a".repeat(64), approvedRevision: 5, approvedBoundaryId: approvalBoundary, approvedBoundaryHash: "a".repeat(64), approvedRequestId: `${PREFIX}-approval-race` });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-race`, { zoneId: raceZone, revision: 5, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "approved", requestedBy: uid.central, decidedBy: uid.founder, decision: "approved" });
});

test("01 — authorized Central Admin creates a draft; Zone, name index and audit persist atomically", async () => {
  const result = await callAs("central", "createServiceZoneDraft", { requestId: "create-01", expectedRevision: 0, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "New Synthetic Zone" });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.workflowStatus, "draft");
  const zone = await db.doc(`service_zones/${result.data.zoneId}`).get();
  assert.equal(zone.get("workflowStatus"), "draft");
  assert.equal(zone.get("isServiceActive"), false);
  assert.equal(zone.get("revision"), 1);
  assert.equal(zone.get("createdBy"), uid.central);
  const indexes = await db.collection("service_zone_name_indexes").where("zoneId", "==", result.data.zoneId).get();
  assert.equal(indexes.size, 1);
  const audit = await db.collection("service_zone_audit").where("zoneId", "==", result.data.zoneId).get();
  assert.equal(audit.size, 1);
  await expectCode("manager", "createServiceZoneDraft", { requestId: "manager-create-01", expectedRevision: 0, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Manager Forbidden Zone" }, "permission-denied");
});

test("02 — Central Admin without boundary-review permission cannot review; protected state remains unchanged", async () => {
  const zoneId = `${PREFIX}-zone-self`;
  const before = await db.doc(`service_location_boundaries/${PREFIX}-boundary-self`).get();
  await expectCode("central-no-review", "reviewServiceZoneBoundary", { requestId: "review-no-permission", expectedRevision: 2, zoneId, boundaryId: `${PREFIX}-boundary-self`, decision: "verified", notes: "not authorized" }, "permission-denied");
  await assertZoneUnchanged(zoneId, { workflowStatus: "boundary_review_pending", revision: 2, isServiceActive: false });
  const after = await db.doc(before.ref.path).get();
  assert.equal(after.get("verificationStatus"), "pending");
  assert.equal(after.get("reviewedBy"), undefined);
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 0);
});

test("03 — Boundary submitter cannot review their own submitted Boundary", async () => {
  const zoneId = `${PREFIX}-zone-self`;
  await expectCode("reviewer-submitter", "reviewServiceZoneBoundary", { requestId: "review-self", expectedRevision: 2, zoneId, boundaryId: `${PREFIX}-boundary-self`, decision: "verified", notes: "self review forbidden" }, "permission-denied");
  await assertZoneUnchanged(zoneId, { workflowStatus: "boundary_review_pending", revision: 2, isServiceActive: false });
  assert.equal((await db.doc(`service_location_boundaries/${PREFIX}-boundary-self`).get()).get("verificationStatus"), "pending");
});

test("04 — Founder may decide only the exact current approval tuple", async () => {
  const zoneId = `${PREFIX}-zone-approval`;
  const common = { requestId: "founder-decision-04", expectedRevision: 3, approvalRequestId: `${PREFIX}-approval-current`, zoneId, revision: 3, boundaryId: `${PREFIX}-boundary-approval`, boundaryHash: "a".repeat(64), requestType: "activation", decision: "approved", notes: "Synthetic exact-tuple approval" };
  await expectCode("founder", "decideServiceZoneFounderApproval", { ...common, boundaryHash: "f".repeat(64) }, "failed-precondition");
  const result = await callAs("founder", "decideServiceZoneFounderApproval", common);
  assert.equal(result.data.ok, true);
  const approval = await db.doc(`service_zone_approval_requests/${PREFIX}-approval-current`).get();
  assert.equal(approval.get("status"), "approved");
  assert.equal(approval.get("decidedBy"), uid.founder);
  const zone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(zone.get("workflowStatus"), "approved");
  assert.equal(zone.get("approvedBoundaryHash"), "a".repeat(64));
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 1);
});

test("05 — Legacy super_admin cannot approve or activate a Zone; state remains unchanged", async () => {
  const zoneId = `${PREFIX}-zone-legacy`;
  const before = await db.doc(`service_zones/${zoneId}`).get();
  await expectCode("legacy", "decideServiceZoneFounderApproval", { requestId: "legacy-approve-05", expectedRevision: 4, approvalRequestId: `${PREFIX}-approval-legacy`, zoneId, revision: 4, boundaryId: `${PREFIX}-boundary-approval`, boundaryHash: "a".repeat(64), requestType: "activation", decision: "approved", notes: "legacy must not decide" }, "permission-denied");
  await expectCode("legacy", "activateServiceZone", { requestId: "legacy-activate-05", expectedRevision: 4, zoneId }, "permission-denied");
  await assertZoneUnchanged(zoneId, { workflowStatus: before.get("workflowStatus"), revision: before.get("revision"), isServiceActive: false });
  assert.equal((await db.doc(`service_zone_approval_requests/${PREFIX}-approval-legacy`).get()).get("status"), "approved");
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 0);
});

test("06 — Area Manager reads only Zones in the assigned City", async () => {
  const page = await callAs("manager", "listVisibleServiceZones", { pageSize: 100 });
  const ids = page.data.zones.map(zone => zone.zoneId);
  assert.ok(ids.includes(`${PREFIX}-zone-city-a`));
  assert.ok(!ids.includes(`${PREFIX}-zone-city-b`));
  await callAs("manager", "getVisibleServiceZoneBoundary", { zoneId: `${PREFIX}-zone-city-a` });
  await expectCode("manager", "getVisibleServiceZoneBoundary", { zoneId: `${PREFIX}-zone-city-b` }, "permission-denied");
});

test("07 — normalized Zone name is unique inside one City but reusable in another City", async () => {
  const first = await callAs("central", "createServiceZoneDraft", { requestId: "name-first-07", expectedRevision: 0, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "  Maple   Park " });
  assert.equal(first.data.ok, true);
  await expectCode("central", "createServiceZoneDraft", { requestId: "name-duplicate-07", expectedRevision: 0, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "maple park" }, "already-exists");
  const otherCity = await callAs("central", "createServiceZoneDraft", { requestId: "name-other-city-07", expectedRevision: 0, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-b`, name: "maple park" });
  assert.equal(otherCity.data.ok, true);
  assert.notEqual(first.data.zoneId, otherCity.data.zoneId);
});

test("08 — stale Boundary revision/hash cannot be approved or activated", async () => {
  const zoneId = `${PREFIX}-zone-stale`;
  await expectCode("founder", "decideServiceZoneFounderApproval", { requestId: "stale-approve-08", expectedRevision: 8, approvalRequestId: `${PREFIX}-approval-stale`, zoneId, revision: 7, boundaryId: `${PREFIX}-boundary-approval`, boundaryHash: "a".repeat(64), requestType: "activation", decision: "approved", notes: "stale tuple" }, "failed-precondition");
  await expectCode("central", "activateServiceZone", { requestId: "stale-activate-08", expectedRevision: 8, zoneId }, "failed-precondition");
  await assertZoneUnchanged(zoneId, { workflowStatus: "founder_review_pending", revision: 8, isServiceActive: false, verifiedBoundaryHash: "b".repeat(64) });
  assert.equal((await db.doc(`service_zone_approval_requests/${PREFIX}-approval-stale`).get()).get("status"), "pending");
});

test("09 — identical request retry replays original response; conflicting payload reuse fails", async () => {
  const payload = { requestId: "idempotent-09", expectedRevision: 0, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Idempotent Zone" };
  const first = await callAs("central", "createServiceZoneDraft", payload);
  const replay = await callAs("central", "createServiceZoneDraft", payload);
  assert.equal(replay.data.zoneId, first.data.zoneId);
  assert.equal(replay.data.replayed, true);
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", first.data.zoneId).get()).size, 1);
  await expectCode("central", "createServiceZoneDraft", { ...payload, name: "Different Payload" }, "already-exists");
  const idempotency = await db.collection("service_zone_idempotency").where("requestId", "==", "idempotent-09").get();
  assert.equal(idempotency.size, 1);
  assert.equal(idempotency.docs[0].get("payloadFingerprint")?.length, 64);
});

test("10 — concurrent activation attempts yield exactly one committed transition", async () => {
  const zoneId = `${PREFIX}-zone-race`;
  const payload = { requestId: "race-activation-10", expectedRevision: 5, zoneId };
  const results = await Promise.allSettled([
    callAs("central", "activateServiceZone", payload),
    callAs("central", "activateServiceZone", { ...payload, requestId: "race-activation-10-b" }),
  ]);
  const fulfilled = results.filter(result => result.status === "fulfilled");
  const rejected = results.filter(result => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "Exactly one activation may commit.");
  assert.equal(rejected.length, 1, "The competing activation must be rejected.");
  assert.ok(["functions/aborted", "functions/failed-precondition", "functions/already-exists"].includes(rejected[0].reason.code));
  const zone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(zone.get("workflowStatus"), "active");
  assert.equal(zone.get("isServiceActive"), true);
  assert.equal(zone.get("revision"), 6);
  const audit = await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get();
  assert.equal(audit.size, 1, "Only one activation audit event may commit.");
});

test.after(async () => {
  for (const client of clients.values()) await deleteApp(client.app).catch(() => {});
  if (db) {
    for (const path of cleanupPaths) await db.doc(path).delete().catch(() => {});
    for (const collection of ["service_zones", "service_location_boundaries", "service_zone_approval_requests", "service_zone_name_indexes", "service_zone_idempotency", "service_zone_audit", "service_zone_notification_outbox", "admin_scope_assignments", "zone_boundary_review_assignments"]) {
      const snap = await db.collection(collection).where("fixtureOnly", "==", true).get().catch(() => null);
      if (snap) for (const doc of snap.docs) await doc.ref.delete().catch(() => {});
    }
  }
  if (adminAuth) for (const [key] of actorRows) await adminAuth.deleteUser(uid[key]).catch(() => {});
  if (adminApp) await deleteAdminApp(adminApp);
});
