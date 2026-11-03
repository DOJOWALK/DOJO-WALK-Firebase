const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword, signOut, connectAuthEmulator } = require("firebase/auth");
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require("firebase-admin/app");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const PASSWORD = "synthetic-emulator-only-password";
const actors = [
  { uid: "test-founder-allowed", email: "test-founder-allowed@example.test", authority: "founder", active: true },
  { uid: "test-founder-inactive", email: "test-founder-inactive@example.test", authority: "founder", active: false },
  { uid: "test-central-admin-authorized", email: "test-central-admin-authorized@example.test", authority: "central_admin", active: true },
  { uid: "test-central-admin-inactive", email: "test-central-admin-inactive@example.test", authority: "central_admin", active: false },
  { uid: "test-boundary-reviewer", email: "test-boundary-reviewer@example.test", authority: "reviewer", active: true },
  { uid: "test-boundary-submitter", email: "test-boundary-submitter@example.test", authority: "central_admin", active: true },
  { uid: "test-area-manager-scoped", email: "test-area-manager-scoped@example.test", authority: "area_manager", active: true },
  { uid: "test-supervisor-scoped", email: "test-supervisor-scoped@example.test", authority: "supervisor", active: true },
  { uid: "test-legacy-super-admin", email: "test-legacy-super-admin@example.test", authority: "legacy_super_admin", active: true },
  { uid: "test-walker", email: "test-walker@example.test", authority: "walker", active: true },
  { uid: "test-customer", email: "test-customer@example.test", authority: "customer", active: true },
];

function assertIsolatedEmulators() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"),
    "Refusing to run: project ID must be a Firebase demo-* project.");
  assert.ok(AUTH_HOST, "Auth Emulator is not configured (FIREBASE_AUTH_EMULATOR_HOST missing).");
  assert.ok(FIRESTORE_HOST, "Firestore Emulator is not configured (FIRESTORE_EMULATOR_HOST missing).");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3",
    "Production DOJO WALK project must never be used by this harness.");
}

let adminApp;
let adminAuth;
let db;
const clientApps = [];

test.before(async () => {
  assertIsolatedEmulators();
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `zone-fixtures-${process.pid}`);
  adminAuth = getAdminAuth(adminApp);
  db = getFirestore(adminApp);

  for (const actor of actors) {
    try {
      const existing = await adminAuth.getUser(actor.uid);
      await adminAuth.deleteUser(existing.uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    await adminAuth.createUser({ uid: actor.uid, email: actor.email, password: PASSWORD, emailVerified: true });

    if (actor.authority === "founder") {
      await db.doc(`founder_users/${actor.uid}`).set({ isActive: actor.active, fixtureOnly: true });
    } else if (actor.authority === "central_admin" || actor.authority === "reviewer" || actor.authority === "legacy_super_admin") {
      await db.doc(`admin_users/${actor.uid}`).set({
        isActive: actor.active,
        role: actor.authority === "legacy_super_admin" ? "super_admin" : "central_admin",
        permissions: actor.authority === "reviewer" ? { zoneBoundaryReview: true } : { zoneOperations: actor.authority === "central_admin" },
        fixtureOnly: true,
      });
    }
  }
});

test("synthetic Auth identities can sign in without custom claims", async () => {
  for (const actor of actors) {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com` }, `client-${actor.uid}-${process.pid}`);
    clientApps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, actor.email, PASSWORD);
    assert.equal(credential.user.uid, actor.uid);
    const claims = (await credential.user.getIdTokenResult()).claims;
    assert.equal(claims.role, undefined, "Synthetic authority must not be supplied as a custom Auth role claim.");
    assert.equal(claims.isFounder, undefined, "Founder authority must not be inferred from a client claim.");
    await signOut(auth);
  }
});

test("synthetic authority documents are isolated in the demo Firestore project", async () => {
  assert.equal((await db.doc("founder_users/test-founder-allowed").get()).get("isActive"), true);
  assert.equal((await db.doc("founder_users/test-founder-inactive").get()).get("isActive"), false);
  assert.equal((await db.doc("admin_users/test-central-admin-authorized").get()).get("role"), "central_admin");
  assert.equal((await db.doc("admin_users/test-legacy-super-admin").get("role"), "super_admin");
});

test.after(async () => {
  if (db) {
    const refs = [
      ...actors.filter(a => a.authority === "founder").map(a => db.doc(`founder_users/${a.uid}`)),
      ...actors.filter(a => ["central_admin", "reviewer", "legacy_super_admin"].includes(a.authority)).map(a => db.doc(`admin_users/${a.uid}`)),
    ];
    for (const ref of refs) await ref.delete().catch(() => {});
  }
  if (adminAuth) {
    for (const actor of actors) await adminAuth.deleteUser(actor.uid).catch(() => {});
  }
  await Promise.all(clientApps.map(deleteApp));
  if (adminApp) await deleteAdminApp(adminApp);
});
