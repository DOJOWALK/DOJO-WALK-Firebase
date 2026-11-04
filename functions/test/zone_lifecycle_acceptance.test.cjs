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

  await seed(`admin_scope_assignments/${PREFIX}-manager-city-a`, { adminUid: uid.manager, role: "city_manager", scopeType: "city", scopeId: `${PREFIX}-city-a`, status: "active", isActive: true });
  await seed(`zone_boundary_review_assignments/${PREFIX}-reviewer-own`, { reviewerUid: uid["reviewer-submitter"], zoneId: `${PREFIX}-zone-self`, boundaryId: `${PREFIX}-boundary-self`, status: "assigned" });

  await seed(`service_zones/${PREFIX}-zone-self`, { schemaVersion: 1, zoneId: `${PREFIX}-zone-self`, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Self Review", normalizedName: "self review", workflowStatus: "boundary_review_pending", isServiceActive: false, revision: 2, currentBoundaryId: `${PREFIX}-boundary-self` });
  await seed(`service_location_boundaries/${PREFIX}-boundary-self`, { locationType: "zone", locationId: `${PREFIX}-zone-self`, zoneId: `${PREFIX}-zone-self`, zoneRevision: 2, revision: 1, points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.5, lng: 77.4 }, { lat: 28.6, lng: 77.4 }, { lat: 28.5, lng: 77.3 }], sourceType: "manuallyDrawn", sourceName: "Synthetic fixture", sourceReference: "fixture:self", verificationStatus: "pending", submittedBy: uid["reviewer-submitter"] });

  const approvalZone = `${PREFIX}-zone-approval`;
  const approvalBoundary = `${PREFIX}-boundary-approval`;
  await seed(`service_zones/${approvalZone}`, { schemaVersion: 1, zoneId: approvalZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Approval Zone", normalizedName: "approval zone", workflowStatus: "founder_review_pending", isServiceActive: false, revision: 3, currentBoundaryId: approvalBoundary, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "a".repeat(64) });
  await seed(`service_location_boundaries/${approvalBoundary}`, { locationType: "zone", locationId: approvalZone, zoneId: approvalZone, zoneRevision: 3, revision: 1, points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.5, lng: 77.4 }, { lat: 28.6, lng: 77.4 }, { lat: 28.5, lng: 77.3 }], sourceType: "governmentGis", sourceName: "Synthetic GIS", sourceReference: "fixture:approval", verificationStatus: "verified", geometryHash: "a".repeat(64), submittedBy: uid.central });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-current`, { zoneId: approvalZone, revision: 3, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "pending", requestedBy: uid.central });

  const legacyZone = `${PREFIX}-zone-legacy`;
  await seed(`service_zones/${legacyZone}`, { schemaVersion: 1, zoneId: legacyZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Legacy Zone", normalizedName: "legacy zone", workflowStatus: "approved", isServiceActive: false, revision: 4, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "a".repeat(64), approvedRevision: 4, approvedBoundaryId: approvalBoundary, approvedBoundaryHash: "a".repeat(64), approvedRequestId: `${PREFIX}-approval-legacy` });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-legacy`, { zoneId: legacyZone, revision: 4, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "approved", requestedBy: uid.central, decidedBy: uid.founder, decision: "approved" });

  const staleZone = `${PREFIX}-zone-stale`;
  await seed(`service_zones/${staleZone}`, { schemaVersion: 1, zoneId: staleZone, stateId: "state-test", districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Stale Zone", normalizedName: "stale zone", workflowStatus: "founder_review_pending", isServiceActive: false, revision: 8, currentBoundaryId: approvalBoundary, verifiedBoundaryId: approvalBoundary, verifiedBoundaryRevision: 7, verifiedBoundaryHash: "b".repeat(64) });
  await seed(`service_zone_approval_requests/${PREFIX}-approval-stale`, { zoneId: staleZone, revision: 7, boundaryId: approvalBoundary, boundaryHash: "a".repeat(64), requestType: "activation", status: "pending", requestedBy: uid.central });

  for (const [zoneId, cityId, boundaryId, hash] of [
    [`${PREFIX}-zone-city-a`, `${PREFIX}-city-a`, `${PREFIX}-boundary-city-a`, "c".repeat(64)],
    [`${PREFIX}-zone-city-b`, `${PREFIX}-city-b`, `${PREFIX}-boundary-city-b`, "d".repeat(64)],
  ]) {
    await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, countryId: "india", stateId: "state-test", districtId: "district-test", cityId, name: zoneId, workflowStatus: "active", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: boundaryId, verifiedBoundaryRevision: 1, verifiedBoundaryHash: hash, boundaryHash: hash });
    await seed(`service_location_boundaries/${boundaryId}`, { locationType: "zone", locationId: zoneId, zoneId, zoneRevision: 1, revision: 1, points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.5, lng: 77.4 }, { lat: 28.6, lng: 77.4 }, { lat: 28.5, lng: 77.3 }], verificationStatus: "verified", geometryHash: hash, submittedBy: uid.central });
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


test("11 — Central creates a canonical pending Boundary draft and advances the Zone revision atomically", async () => {
  const zoneId = `${PREFIX}-zone-boundary-create`;
  await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, stateId: "state-test", districtId: "district-test",
    cityId: `${PREFIX}-city-a`, name: "Boundary Draft Zone", normalizedName: "boundary draft zone",
    workflowStatus: "draft", isServiceActive: false, revision: 1, createdBy: uid.central });
  const result = await callAs("central", "createServiceZoneBoundaryDraft", {
    requestId: "boundary-create-11", expectedRevision: 1, zoneId,
    points: [{lat:28.5,lng:77.3},{lat:28.5,lng:77.4},{lat:28.6,lng:77.4},{lat:28.5,lng:77.3}],
    sourceType: "manuallyDrawn", sourceName: "Synthetic test", sourceReference: "fixture:boundary-11"
  });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.workflowStatus, "boundary_review_pending");
  assert.equal(result.data.revision, 2);
  const zone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(zone.get("revision"), 2);
  assert.equal(zone.get("currentBoundaryId"), result.data.boundaryId);
  const boundaryPath = `service_location_boundaries/${result.data.boundaryId}`;
  track(boundaryPath);
  const boundary = await db.doc(boundaryPath).get();
  assert.equal(boundary.get("verificationStatus"), "pending");
  assert.equal(boundary.get("zoneRevision"), 2);
  assert.equal(boundary.get("geometryCanonicalizationVersion"), 1);
  assert.match(boundary.get("geometryHash"), /^[a-f0-9]{64}$/);
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 1);
});

test("12 — Central submits only the exact verified Boundary and persists the Founder approval tuple", async () => {
  const zoneId = `${PREFIX}-zone-submit`, boundaryId = `${PREFIX}-boundary-submit`;
  const boundaryHash = "e".repeat(64);
  track(`service_zones/${zoneId}`);
  await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, stateId: "state-test", districtId: "district-test",
    cityId: `${PREFIX}-city-a`, name: "Submission Zone", normalizedName: "submission zone",
    workflowStatus: "boundary_verified", isServiceActive: false, revision: 4, createdBy: uid.central, currentBoundaryId: boundaryId,
    verifiedBoundaryId: boundaryId, verifiedBoundaryRevision: 1, verifiedBoundaryHash: boundaryHash });
  track(`service_location_boundaries/${boundaryId}`);
  await seed(`service_location_boundaries/${boundaryId}`, { locationType: "zone", locationId: zoneId, zoneId,
    zoneRevision: 4, revision: 1, verificationStatus: "verified", geometryHash: boundaryHash,
    submittedBy: uid.central });
  const result = await callAs("central", "submitServiceZoneForFounderReview", {
    requestId: "founder-submit-12", expectedRevision: 4, zoneId, boundaryId
  });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.workflowStatus, "founder_review_pending");
  assert.equal(result.data.revision, 5);
  const approvalPath = `service_zone_approval_requests/${result.data.approvalRequestId}`;
  track(approvalPath);
  const approval = await db.doc(approvalPath).get();
  assert.equal(approval.get("zoneId"), zoneId);
  assert.equal(approval.get("revision"), 5);
  assert.equal(approval.get("boundaryId"), boundaryId);
  assert.equal(approval.get("boundaryHash"), boundaryHash);
  assert.equal(approval.get("requestType"), "activation");
  assert.equal(approval.get("status"), "pending");
  const zone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(zone.get("currentApprovalRequestId"), result.data.approvalRequestId);
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 1);
});


test("13 — Routine deactivation requires exact Founder approval and then disables new Zone service", async () => {
  const zoneId = `${PREFIX}-zone-deactivate`, boundaryId = `${PREFIX}-boundary-deactivate`, boundaryHash = "1".repeat(64);
  track(`service_zones/${zoneId}`);
  await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, cityId: `${PREFIX}-city-a`,
    name: "Deactivation Zone", workflowStatus: "active", isServiceActive: true, revision: 10, createdBy: uid.central,
    verifiedBoundaryId: boundaryId, verifiedBoundaryRevision: 2, verifiedBoundaryHash: boundaryHash });
  const requested = await callAs("central", "requestServiceZoneDeactivation", {
    requestId: "deactivation-request-13", expectedRevision: 10, zoneId, notes: "Synthetic routine deactivation"
  });
  assert.equal(requested.data.workflowStatus, "deactivation_pending");
  track(`service_zone_approval_requests/${requested.data.approvalRequestId}`);
  const decided = await callAs("founder", "decideServiceZoneFounderApproval", {
    requestId: "deactivation-founder-13", expectedRevision: 11, approvalRequestId: requested.data.approvalRequestId,
    zoneId, revision: 11, boundaryId, boundaryHash, requestType: "routine_deactivation",
    decision: "approved", notes: "Approved in synthetic test"
  });
  assert.equal(decided.data.workflowStatus, "inactive");
  const zone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(zone.get("workflowStatus"), "inactive");
  assert.equal(zone.get("isServiceActive"), false);
  assert.equal(zone.get("revision"), 12);
});

test("14 — Emergency suspension immediately blocks service and durably queues Founder notification", async () => {
  const zoneId = `${PREFIX}-zone-emergency`, boundaryId = `${PREFIX}-boundary-emergency`;
  track(`service_zones/${zoneId}`);
  await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, cityId: `${PREFIX}-city-a`,
    name: "Emergency Zone", workflowStatus: "active", isServiceActive: true, revision: 20, createdBy: uid.central,
    verifiedBoundaryId: boundaryId, verifiedBoundaryRevision: 1, verifiedBoundaryHash: "2".repeat(64) });
  await expectCode("central-no-review", "suspendServiceZoneForEmergency", {
    requestId: "emergency-suspend-denied-14", expectedRevision: 20, zoneId,
    reason: "Actor lacks emergency permission", severity: "SEV-1"
  }, "permission-denied");
  await assertZoneUnchanged(zoneId, { workflowStatus: "active", revision: 20, isServiceActive: true });
  const result = await callAs("central", "suspendServiceZoneForEmergency", {
    requestId: "emergency-suspend-14", expectedRevision: 20, zoneId,
    reason: "Synthetic safety event", severity: "SEV-1"
  });
  assert.equal(result.data.workflowStatus, "suspended");
  const zone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(zone.get("workflowStatus"), "suspended");
  assert.equal(zone.get("isServiceActive"), false);
  assert.equal(zone.get("revision"), 21);
  const outboxPath = `service_zone_notification_outbox/${result.data.notificationId}`;
  track(outboxPath);
  const outbox = await db.doc(outboxPath).get();
  assert.equal(outbox.get("recipientAuthority"), "founder");
  assert.equal(outbox.get("status"), "pending");
  assert.equal(outbox.get("attemptCount"), 0);
  assert.deepEqual(outbox.get("retryScheduleMinutes"), [1, 5, 15, 60]);
  assert.equal(outbox.get("escalationAfterFailures"), 5);
});

test("15 — Reactivation requires Founder approval of the exact request before Central commits it", async () => {
  const zoneId = `${PREFIX}-zone-reactivate`, boundaryId = `${PREFIX}-boundary-reactivate`, boundaryHash = "3".repeat(64);
  track(`service_zones/${zoneId}`);
  await seed(`service_zones/${zoneId}`, { schemaVersion: 1, zoneId, cityId: `${PREFIX}-city-a`,
    name: "Reactivation Zone", workflowStatus: "suspended", isServiceActive: false, revision: 30, createdBy: uid.central,
    suspensionReason: "Synthetic suspension", suspensionSeverity: "SEV-2",
    verifiedBoundaryId: boundaryId, verifiedBoundaryRevision: 3, verifiedBoundaryHash: boundaryHash });
  const requested = await callAs("central", "requestServiceZoneReactivation", {
    requestId: "reactivation-request-15", expectedRevision: 30, zoneId, reason: "Synthetic controls verified"
  });
  assert.equal(requested.data.workflowStatus, "reactivation_pending");
  track(`service_zone_approval_requests/${requested.data.approvalRequestId}`);
  await callAs("founder", "decideServiceZoneFounderApproval", {
    requestId: "reactivation-founder-15", expectedRevision: 31, approvalRequestId: requested.data.approvalRequestId,
    zoneId, revision: 31, boundaryId, boundaryHash, requestType: "reactivation",
    decision: "approved", notes: "Synthetic reactivation approval"
  });
  const beforeCommit = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(beforeCommit.get("workflowStatus"), "reactivation_pending");
  assert.equal(beforeCommit.get("isServiceActive"), false);
  const result = await callAs("central", "reactivateServiceZone", { requestId: "reactivation-commit-15", expectedRevision: 32, zoneId });
  assert.equal(result.data.workflowStatus, "active");
  const after = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(after.get("workflowStatus"), "active");
  assert.equal(after.get("isServiceActive"), true);
  assert.equal(after.get("revision"), 33);
});


test("16 — Full synthetic activation path: draft → Boundary review → Founder approval → Central activation", async () => {
  const created = await callAs("central", "createServiceZoneDraft", {
    requestId: "full-flow-create-16", expectedRevision: 0, stateId: "state-test",
    districtId: "district-test", cityId: `${PREFIX}-city-a`, name: "Full Lifecycle Synthetic Zone"
  });
  const zoneId = created.data.zoneId;
  const boundaryDraft = await callAs("central", "createServiceZoneBoundaryDraft", {
    requestId: "full-flow-boundary-16", expectedRevision: 1, zoneId,
    points: [{lat:28.51,lng:77.31},{lat:28.51,lng:77.41},{lat:28.61,lng:77.41},{lat:28.51,lng:77.31}],
    sourceType: "governmentGis", sourceName: "Synthetic city GIS", sourceReference: "fixture:full-flow-16"
  });
  const boundaryId = boundaryDraft.data.boundaryId;
  track(`service_location_boundaries/${boundaryId}`);
  const assignmentPath = `zone_boundary_review_assignments/${PREFIX}-full-flow-review`;
  track(assignmentPath);
  await seed(assignmentPath, { reviewerUid: uid["reviewer-submitter"], zoneId, boundaryId, status: "assigned", isActive: true });
  const reviewed = await callAs("reviewer-submitter", "reviewServiceZoneBoundary", {
    requestId: "full-flow-review-16", expectedRevision: 2, zoneId, boundaryId,
    decision: "verified", notes: "Synthetic geometry validated"
  });
  assert.equal(reviewed.data.workflowStatus, "boundary_verified");
  const submitted = await callAs("central", "submitServiceZoneForFounderReview", {
    requestId: "full-flow-submit-16", expectedRevision: 3, zoneId, boundaryId
  });
  assert.equal(submitted.data.workflowStatus, "founder_review_pending");
  track(`service_zone_approval_requests/${submitted.data.approvalRequestId}`);
  const boundary = await db.doc(`service_location_boundaries/${boundaryId}`).get();
  const founderDecision = await callAs("founder", "decideServiceZoneFounderApproval", {
    requestId: "full-flow-founder-16", expectedRevision: 4,
    approvalRequestId: submitted.data.approvalRequestId, zoneId, revision: 4, boundaryId,
    boundaryHash: boundary.get("geometryHash"), requestType: "activation",
    decision: "approved", notes: "Synthetic exact-tuple approval"
  });
  assert.equal(founderDecision.data.workflowStatus, "approved");
  const activated = await callAs("central", "activateServiceZone", {
    requestId: "full-flow-activate-16", expectedRevision: 5, zoneId
  });
  assert.equal(activated.data.workflowStatus, "active");
  const finalZone = await db.doc(`service_zones/${zoneId}`).get();
  assert.equal(finalZone.get("workflowStatus"), "active");
  assert.equal(finalZone.get("isServiceActive"), true);
  assert.equal(finalZone.get("revision"), 6);
  assert.equal(finalZone.get("verifiedBoundaryHash"), boundary.get("geometryHash"));
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 6);
});

test("17 — Boundary review rejects coordinates whose stored canonical geometry hash was altered", async () => {
  const zoneId = `${PREFIX}-zone-hash-mismatch`;
  const boundaryId = `${PREFIX}-boundary-hash-mismatch`;
  const assignmentPath = `zone_boundary_review_assignments/${PREFIX}-review-hash-mismatch`;
  track(`service_zones/${zoneId}`);
  track(`service_location_boundaries/${boundaryId}`);
  track(assignmentPath);
  await seed(`service_zones/${zoneId}`, {
    schemaVersion: 1, zoneId, cityId: `${PREFIX}-city-a`, name: "Hash mismatch",
    workflowStatus: "boundary_review_pending", isServiceActive: false, revision: 2,
    currentBoundaryId: boundaryId
  });
  await seed(`service_location_boundaries/${boundaryId}`, {
    locationType: "zone", locationId: zoneId, zoneId, zoneRevision: 2, revision: 1,
    points: [{lat:28.5,lng:77.3},{lat:28.5,lng:77.4},{lat:28.6,lng:77.4},{lat:28.5,lng:77.3}],
    sourceType: "manuallyDrawn", sourceName: "Synthetic test", sourceReference: "fixture:hash-mismatch",
    verificationStatus: "pending", geometryHash: "f".repeat(64), submittedBy: uid.central
  });
  await seed(assignmentPath, {
    reviewerUid: uid["reviewer-submitter"], zoneId, boundaryId, status: "assigned", isActive: true
  });
  await expectCode("reviewer-submitter", "reviewServiceZoneBoundary", {
    requestId: "review-hash-mismatch-17", expectedRevision: 2, zoneId, boundaryId,
    decision: "verified", notes: "Stored hash must match canonical coordinates"
  }, "failed-precondition");
  await assertZoneUnchanged(zoneId, {
    workflowStatus: "boundary_review_pending", revision: 2, isServiceActive: false
  });
  const boundary = await db.doc(`service_location_boundaries/${boundaryId}`).get();
  assert.equal(boundary.get("verificationStatus"), "pending");
  assert.equal(boundary.get("reviewedBy"), undefined);
  assert.equal((await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get()).size, 0);
});

test.after(async () => {
  for (const client of clients.values()) await deleteApp(client.app).catch(() => {});
  if (db) {
    for (const path of cleanupPaths) await db.doc(path).delete().catch(() => {});
    // Remove records created by the synthetic actors during the test. These are
    // not fixtureOnly because callable writes must use the same schema as real
    // server writes; leaking them into later tests changes pagination results.
    const createdZones = await db.collection("service_zones").where("createdBy", "==", uid.central).get().catch(() => null);
    if (createdZones) {
      for (const zone of createdZones.docs) {
        const zoneId = zone.id;
        const indexes = await db.collection("service_zone_name_indexes").where("zoneId", "==", zoneId).get().catch(() => null);
        const audits = await db.collection("service_zone_audit").where("zoneId", "==", zoneId).get().catch(() => null);
        for (const doc of [...(indexes?.docs ?? []), ...(audits?.docs ?? [])]) await doc.ref.delete().catch(() => {});
        await zone.ref.delete().catch(() => {});
      }
    }
    for (const actorUid of Object.values(uid)) {
      const idempotency = await db.collection("service_zone_idempotency").where("actorUid", "==", actorUid).get().catch(() => null);
      if (idempotency) for (const doc of idempotency.docs) await doc.ref.delete().catch(() => {});
    }
    for (const collection of ["service_zones", "service_location_boundaries", "service_zone_approval_requests", "service_zone_name_indexes", "service_zone_idempotency", "service_zone_audit", "service_zone_notification_outbox", "admin_scope_assignments", "zone_boundary_review_assignments"]) {
      const snap = await db.collection(collection).where("fixtureOnly", "==", true).get().catch(() => null);
      if (snap) for (const doc of snap.docs) await doc.ref.delete().catch(() => {});
    }
  }
  if (adminAuth) for (const [key] of actorRows) await adminAuth.deleteUser(uid[key]).catch(() => {});
  if (adminApp) await deleteAdminApp(adminApp);
});
