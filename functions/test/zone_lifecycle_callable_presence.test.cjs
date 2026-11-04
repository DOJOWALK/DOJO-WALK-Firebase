const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1";
const FUNCTIONS_PORT = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);
const REGION = "asia-south1";

const requiredZoneLifecycleCallables = [
  "createServiceZoneDraft",
  "createServiceZoneBoundaryDraft",
  "reviewServiceZoneBoundary",
  "submitServiceZoneForFounderReview",
  "decideServiceZoneFounderApproval",
  "activateServiceZone",
  "requestServiceZoneDeactivation",
  "suspendServiceZoneForEmergency",
  "requestServiceZoneReactivation",
  "reactivateServiceZone",
];

let app;
let functions;

test.before(() => {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"),
    "Refusing to run outside an isolated Firebase demo-* project.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3",
    "Production Firebase project is forbidden.");
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST,
    "Auth Emulator must be active for the isolated Zone test suite.");
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,
    "Firestore Emulator must be active for the isolated Zone test suite.");

  app = initializeApp({
    projectId: PROJECT_ID,
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
  }, `zone-lifecycle-presence-${process.pid}`);
  functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, FUNCTIONS_HOST, FUNCTIONS_PORT);
});

for (const callableName of requiredZoneLifecycleCallables) {
  test(`baseline inventory: ${callableName} is not exported yet`, async () => {
    const invoke = httpsCallable(functions, callableName);
    await assert.rejects(
      invoke({}),
      error => error && error.code === "functions/not-found",
      `Expected ${callableName} to be absent before lifecycle implementation; any other response needs review.`,
    );
  });
}

test.after(async () => {
  if (app) await deleteApp(app);
});
