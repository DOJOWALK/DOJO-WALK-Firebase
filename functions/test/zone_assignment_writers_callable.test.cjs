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
const PASSWORD = "synthetic-assignment-writer-test-password";
const REGION = "asia-south1";
const actors = [
  ["founder", "test-writer-founder@example.test"],
  ["central", "test-writer-central@example.test"],
  ["central-inactive", "test-writer-central-inactive@example.test"],
  ["manager", "test-writer-manager@example.test"],
  ["supervisor", "test-writer-supervisor@example.test"],
  ["walker", "test-writer-walker@example.test"],
  ["walker-unapproved", "test-writer-walker-unapproved@example.test"],
  ["reviewer", "test-writer-reviewer@example.test"],
  ["customer", "test-writer-customer@example.test"],
  ["legacy-admin", "test-writer-legacy-admin@example.test"],
];
const uid = Object.fromEntries(actors.map(([key]) => [key, `test-writer-${key}`]));
const clients = new Map();
let adminApp;
let adminAuth;
let db;

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires a Firebase demo-* project.");
  assert.ok(AUTH_HOST && FIRESTORE_HOST, "Auth and Firestore Emulator hosts are required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production Firebase project is forbidden.");
}

async function callAs(actor, name, payload) {
  const client = clients.get(actor);
  assert.ok(client, `Missing synthetic client for ${actor}`);
  return httpsCallable(client.functions, name)(payload);
}

async function expectDenied(actor, name, payload) {
  await assert.rejects(
    callAs(actor, name, payload),
    error => error && ["functions/permission-denied", "functions/failed-precondition"].includes(error.code),
    `Expected ${actor} to be denied by ${name}`,
  );
}

async function expectCallableDenied(actor, name, payload) {
  await expectDenied(actor, name, payload);
}

test.before(async () => {
  assertEmulatorIsolation();
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `zone-assignment-writers-${process.pid}`);
  adminAuth = getAdminAuth(adminApp);
  db = getFirestore(adminApp);

  for (const [key, email] of actors) {
    await adminAuth.deleteUser(uid[key]).catch(error => {
      if (error.code !== "auth/user-not-found") throw error;
    });
    await adminAuth.createUser({ uid: uid[key], email, password: PASSWORD, emailVerified: true });
  }

  const fixtures = {
    [`founder_users/${uid.founder}`]: { authorityType: "founder_ceo", isActive: true, permissions: { cityManagerAppointmentApproval: true }, fixtureOnly: true },
    [`admin_users/${uid.central}`]: { role: "central_admin", isActive: true, permissions: { zoneOperations: true }, fixtureOnly: true },
    [`admin_users/${uid["central-inactive"]}`]: { role: "central_admin", isActive: false, permissions: { zoneOperations: true }, fixtureOnly: true },
    [`admin_users/${uid.manager}`]: { role: "city_manager", isActive: true, fixtureOnly: true },
    [`admin_users/${uid.supervisor}`]: { role: "zone_supervisor", isActive: true, fixtureOnly: true },
    [`admin_users/${uid.reviewer}`]: { role: "admin", isActive: true, permissions: { zoneBoundaryReview: true }, fixtureOnly: true },
    [`admin_users/${uid["legacy-admin"]}`]: { role: "super_admin", isActive: true, fixtureOnly: true },
    [`walkers/${uid.walker}`]: { status: "approved", isApproved: true, isActive: true, fixtureOnly: true },
    [`walkers/${uid["walker-unapproved"]}`]: { status: "under_review", isApproved: false, isActive: false, fixtureOnly: true },
    "service_zones/writer-zone-active": { schemaVersion: 1, zoneId: "writer-zone-active", cityId: "writer-city-a", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: "writer-boundary-active", verifiedBoundaryRevision: 1, boundaryHash: "d".repeat(64), fixtureOnly: true },
    "service_zones/writer-zone-inactive": { schemaVersion: 1, zoneId: "writer-zone-inactive", cityId: "writer-city-a", status: "inactive", isServiceActive: false, revision: 1, fixtureOnly: true },
    "service_location_boundaries/writer-boundary-active": { locationType: "zone", locationId: "writer-zone-active", zoneId: "writer-zone-active", zoneRevision: 1, revision: 1, verificationStatus: "verified", geometryHash: "d".repeat(64), points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }], fixtureOnly: true },
    "service_zones/writer-zone-other-city": { schemaVersion: 1, zoneId: "writer-zone-other-city", cityId: "writer-city-b", status: "active", isServiceActive: true, revision: 1, verifiedBoundaryId: "writer-boundary-other", verifiedBoundaryRevision: 1, boundaryHash: "e".repeat(64), fixtureOnly: true },
    "service_location_boundaries/writer-boundary-other": { locationType: "zone", locationId: "writer-zone-other-city", zoneId: "writer-zone-other-city", zoneRevision: 1, revision: 1, verificationStatus: "verified", geometryHash: "e".repeat(64), points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }], fixtureOnly: true },
  };
  for (const [path, data] of Object.entries(fixtures)) await db.doc(path).set(data);

  for (const [key, email] of actors) {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com` }, `writer-client-${key}-${process.pid}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    await signInWithEmailAndPassword(auth, email, PASSWORD);
    const functions = getFunctions(app, REGION);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    clients.set(key, { app, auth, functions });
  }
});

test("Founder alone can issue a scoped City Manager appointment approval", async () => {
  const result = await callAs("founder", "approveCityManagerAppointment", {
    targetUid: uid.manager, cityId: "writer-city-a", reason: "Synthetic appointment approval",
    approvalId: "writer-approval-city-manager-1",
  });
  assert.equal(result.data.ok, true);
  const approval = await db.doc("founder_appointment_approvals/writer-approval-city-manager-1").get();
  assert.equal(approval.get("approvedBy"), uid.founder);
  assert.equal(approval.get("targetUid"), uid.manager);
  await expectCallableDenied("central", "approveCityManagerAppointment", {
    targetUid: uid.manager, cityId: "writer-city-a", reason: "forbidden", approvalId: "writer-approval-forbidden",
  });
  await expectCallableDenied("founder", "approveCityManagerAppointment", {
    targetUid: uid.founder, cityId: "writer-city-a", reason: "self", approvalId: "writer-approval-self",
  });
});

test("Central Admin executes only a valid Founder-approved City Manager appointment", async () => {
  await callAs("founder", "approveCityManagerAppointment", {
    targetUid: uid.manager, cityId: "writer-city-a", reason: "approved", approvalId: "writer-approval-execute",
  });
  const result = await callAs("central", "assignCityManager", {
    targetUid: uid.manager, cityId: "writer-city-a", approvalId: "writer-approval-execute",
    assignmentId: "writer-manager-city-a", reason: "Execute approved appointment",
  });
  assert.equal(result.data.ok, true);
  assert.equal((await db.doc("admin_scope_assignments/writer-manager-city-a").get()).get("scopeId"), "writer-city-a");
  await expectCallableDenied("central", "assignCityManager", {
    targetUid: uid.manager, cityId: "writer-city-b", approvalId: "missing-approval",
    assignmentId: "writer-manager-city-b", reason: "missing approval",
  });
});

test("Only active Central Admin can create scoped Supervisor assignments", async () => {
  const result = await callAs("central", "assignZoneSupervisor", {
    targetUid: uid.supervisor, zoneId: "writer-zone-active",
    assignmentId: "writer-supervisor-zone-active", reason: "Zone staffing",
  });
  assert.equal(result.data.ok, true);
  await expectCallableDenied("central-inactive", "assignZoneSupervisor", {
    targetUid: uid.supervisor, zoneId: "writer-zone-active",
    assignmentId: "writer-supervisor-denied", reason: "inactive actor",
  });
  await expectCallableDenied("supervisor", "assignZoneSupervisor", {
    targetUid: uid.supervisor, zoneId: "writer-zone-active",
    assignmentId: "writer-supervisor-self", reason: "self assignment",
  });
  await expectCallableDenied("central", "assignZoneSupervisor", {
    targetUid: uid.supervisor, zoneId: "writer-zone-inactive",
    assignmentId: "writer-supervisor-inactive-zone", reason: "inactive zone",
  });
});

test("Supervisor cardinality is one primary assignment per active Zone", async () => {
  await callAs("central", "assignZoneSupervisor", {
    targetUid: uid.supervisor, zoneId: "writer-zone-active",
    assignmentId: "writer-supervisor-cardinality-a", reason: "first",
  });
  await expectCallableDenied("central", "assignZoneSupervisor", {
    targetUid: uid.manager, zoneId: "writer-zone-active",
    assignmentId: "writer-supervisor-cardinality-b", reason: "duplicate primary",
  });
});

test("Walker assignment requires Approved + Active profile and verified active canonical Zone", async () => {
  const result = await callAs("central", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "writer-zone-active",
    assignmentId: "writer-walker-zone-active", reason: "Operational assignment",
  });
  assert.equal(result.data.ok, true);
  await expectCallableDenied("central", "assignWalkerToZone", {
    targetUid: uid["walker-unapproved"], zoneId: "writer-zone-active",
    assignmentId: "writer-walker-unapproved", reason: "unapproved walker",
  });
  await expectCallableDenied("central", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "writer-zone-inactive",
    assignmentId: "writer-walker-inactive-zone", reason: "inactive zone",
  });
});

test("Legacy onboarding zone preferences and legacy super_admin cannot authorize assignment writes", async () => {
  await expectCallableDenied("legacy-admin", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "writer-zone-active",
    assignmentId: "writer-walker-legacy-admin", reason: "legacy role",
  });
  await expectCallableDenied("walker", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "writer-zone-other-city",
    assignmentId: "writer-walker-self", reason: "self assignment",
  });
});

test("Boundary Reviewer assignment requires explicit review permission and forbids self-review", async () => {
  const result = await callAs("central", "assignBoundaryReviewer", {
    reviewerUid: uid.reviewer, boundaryId: "writer-boundary-active",
    assignmentId: "writer-reviewer-boundary-active", reason: "Independent review",
  });
  assert.equal(result.data.ok, true);
  await expectCallableDenied("central", "assignBoundaryReviewer", {
    reviewerUid: uid.central, boundaryId: "writer-boundary-active",
    assignmentId: "writer-reviewer-no-permission", reason: "no review permission",
  });
  await expectCallableDenied("central", "assignBoundaryReviewer", {
    reviewerUid: uid.central, boundaryId: "writer-boundary-active",
    assignmentId: "writer-reviewer-self-review", reason: "submitter cannot review",
  });
});

test("Unauthenticated, Customer, Walker, Supervisor, City Manager and inactive Admin cannot mutate assignments", async () => {
  const payload = { targetUid: uid.walker, zoneId: "writer-zone-active", assignmentId: "writer-denied", reason: "denied actor" };
  for (const actor of ["customer", "walker", "supervisor", "manager", "central-inactive"]) {
    await expectCallableDenied(actor, "assignWalkerToZone", payload);
  }
});

test("Central Admin cannot grant Founder or Central Admin membership or elevate itself", async () => {
  await expectCallableDenied("central", "assignCityManager", {
    targetUid: uid.central, cityId: "writer-city-a", approvalId: "forged",
    assignmentId: "writer-self-elevation", reason: "self elevation",
  });
  await expectCallableDenied("central", "assignCityManager", {
    targetUid: uid.founder, cityId: "writer-city-a", approvalId: "forged",
    assignmentId: "writer-founder-elevation", reason: "founder elevation",
  });
});

test("Assignment revocation requires Central Admin, reason, and closes record with audit", async () => {
  await callAs("central", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "writer-zone-active",
    assignmentId: "writer-walker-revoke", reason: "create before revoke",
  });
  const result = await callAs("central", "revokeZoneAssignment", {
    assignmentType: "walker_zone", assignmentId: "writer-walker-revoke", reason: "Worker moved out of Zone",
  });
  assert.equal(result.data.ok, true);
  const assignment = await db.doc("walker_zone_assignments/writer-walker-revoke").get();
  assert.equal(assignment.get("status"), "revoked");
  assert.ok(assignment.get("revokedAt"));
  const audit = await db.collection("service_zone_assignment_audit")
    .where("assignmentId", "==", "writer-walker-revoke").get();
  assert.ok(audit.size >= 2, "Create and revoke must both be audited.");
  await expectCallableDenied("walker", "revokeZoneAssignment", {
    assignmentType: "walker_zone", assignmentId: "writer-walker-revoke", reason: "self revoke",
  });
});

test("Assignment mutation rejects missing reason and malformed IDs", async () => {
  await expectCallableDenied("central", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "writer-zone-active", assignmentId: "bad-reason", reason: " ",
  });
  await expectCallableDenied("central", "assignWalkerToZone", {
    targetUid: uid.walker, zoneId: "../other", assignmentId: "bad-zone", reason: "invalid id",
  });
});

test("Direct client writes to authority, assignment and approval collections remain denied", async () => {
  const client = clients.get("central");
  const { getFirestore: getClientFirestore, doc, setDoc } = require("firebase/firestore");
  const clientDb = getClientFirestore(client.app);
  for (const path of [
    `founder_users/${uid.central}`,
    `admin_scope_assignments/client-forged`,
    `walker_zone_assignments/client-forged`,
    `zone_boundary_review_assignments/client-forged`,
    "founder_appointment_approvals/client-forged",
    "service_zone_assignment_audit/client-forged",
  ]) {
    await assert.rejects(setDoc(doc(clientDb, path), { fixtureOnly: false }));
  }
});

test.after(async () => {
  for (const client of clients.values()) await deleteApp(client.app).catch(() => {});
  if (db) {
    const collections = [
      "founder_users", "admin_users", "walkers", "service_zones", "service_location_boundaries",
      "founder_appointment_approvals", "admin_scope_assignments", "walker_zone_assignments",
      "zone_boundary_review_assignments", "service_zone_assignment_audit",
    ];
    for (const collection of collections) {
      const snapshot = await db.collection(collection).get().catch(() => null);
      if (snapshot) for (const doc of snapshot.docs) {
        if (doc.id.startsWith("test-writer-") || doc.id.startsWith("writer-")) await doc.ref.delete().catch(() => {});
      }
    }
  }
  if (adminAuth) for (const [key] of actors) await adminAuth.deleteUser(uid[key]).catch(() => {});
  if (adminApp) await deleteAdminApp(adminApp);
});
