const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// This test must only run while the Firebase Auth and Functions Emulators are active.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Auth Emulator integration test requires the Firebase Emulators; refusing to run outside emulator tests.");
}

const projectId = process.env.GCLOUD_PROJECT || "demo-dojo-rules-tests";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const callableUrl = `http://${functionsHost}/${projectId}/asia-south1/approveInitialServiceAreaLaunch`;

async function callApproval(idToken) {
  return fetch(callableUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data: { areaId: "../invalid", reason: "Emulator authentication check only." } }),
  });
}

test("Firebase Auth Emulator ID token is recognized by the callable Functions Emulator", async (t) => {
  const unauthenticated = await callApproval(null);
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedBody = await unauthenticated.json();
  assert.equal(unauthenticatedBody.error?.status, "UNAUTHENTICATED");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const signupResponse = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `founder-auth-test-${suffix}@example.test`,
        password: `Test-${suffix}-Aa9!`,
        returnSecureToken: true,
      }),
    },
  );
  const signupBody = await signupResponse.json();
  assert.equal(signupResponse.ok, true, `Auth Emulator sign-up failed: ${JSON.stringify(signupBody)}`);
  assert.equal(typeof signupBody.idToken, "string");
  assert.equal(typeof signupBody.localId, "string");

  t.after(async () => {
    // Auth Emulator is ephemeral for this workflow; no production identity is created.
    // The generated account disappears when the emulator process exits.
  });

  const authenticated = await callApproval(signupBody.idToken);
  assert.equal(authenticated.status, 400);
  const authenticatedBody = await authenticated.json();
  // The callable reaches argument validation only when Functions verifies the
  // Firebase Auth Emulator token and populates request.auth.
  assert.equal(authenticatedBody.error?.status, "INVALID_ARGUMENT");
});
