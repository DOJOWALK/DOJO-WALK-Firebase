const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, deleteUser } = require("firebase/auth");
const { getFirestore } = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-dojo-rules-tests";
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authHost = process.env.AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const db = getFirestore();

function callableUrl(name = "manageServiceLocationImportRun") {
  return `http://${functionsHost}/${projectId}/asia-south1/${name}`;
}

async function callCallable(url, token, data) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data }),
  });
}

test("real callable HTTP timeout after committed begin is recovered read-only without replay", async (t) => {
  const suffix = randomUUID().replace(/-/g, "");
  const runId = `http_timeout_${suffix}`;
  const fingerprint = `sha256:${"d".repeat(64)}`;
  const app = initializeApp({ projectId, apiKey: "fake-api-key" }, `callable-timeout-${suffix}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });

  let user;
  let proxy;
  let proxyUrl;
  let adminRef;
  const runRef = db.doc(`service_location_import_runs/${runId}`);

  t.after(async () => {
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    await runRef.delete().catch(() => {});
    if (adminRef) await adminRef.delete().catch(() => {});
    if (user) await deleteUser(user).catch(() => {});
    await deleteApp(app).catch(() => {});
  });

  const credential = await createUserWithEmailAndPassword(
    auth,
    `callable-timeout-${suffix}@example.test`,
    `T3st-${suffix}!`,
  );
  user = credential.user;
  const token = await user.getIdToken();
  await db.doc(`admin_users/${user.uid}`).set({ role: "super_admin", isActive: true });
  adminRef = db.doc(`admin_users/${user.uid}`);

  // Proxy waits until the Functions Emulator has completed the request, then
  // deliberately drops the successful response as a deterministic client timeout.
  proxy = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const upstream = await fetch(callableUrl(), {
        method: "POST",
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
          authorization: req.headers.authorization || "",
        },
        body: Buffer.concat(chunks),
      });
      const upstreamBody = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(upstream.status, { "content-type": "application/json" });
        res.end(upstreamBody);
        return;
      }
      // Reaching this point proves the callable returned success; the test client
      // sees only a timeout, exactly the ambiguous-response case under test.
      res.writeHead(504, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "simulated response loss after server commit" }));
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "proxy failure" }));
    }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

  const beginPayload = {
    action: "begin",
    runId,
    inputFingerprint: fingerprint,
    countryId: "IN",
    fileName: "states.csv",
  };
  const timedOut = await callCallable(proxyUrl, token, beginPayload);
  assert.equal(timedOut.status, 504, "client must observe the deliberately lost successful response");

  // Verify durable server-side state directly, then use the real callable's
  // authenticated inspect action as the supported recovery path.
  const committed = await runRef.get();
  assert.equal(committed.exists, true, "begin marker must have committed before the response was dropped");
  assert.equal(committed.get("status"), "started");
  assert.equal(committed.get("importedBy"), user.uid);
  assert.equal((await adminRef.get()).get("role"), "super_admin");

  const inspectResponse = await callCallable(callableUrl(), token, {
    action: "inspect",
    runId,
    inputFingerprint: fingerprint,
  });
  assert.equal(inspectResponse.status, 200, await inspectResponse.clone().text());
  const inspectBody = await inspectResponse.json();
  const inspected = inspectBody.result ?? inspectBody.data;
  assert.equal(inspected.runId, runId);
  assert.equal(inspected.status, "started");
  assert.equal(inspected.reconciliationRequired, true);

  // A retry of the non-idempotent begin operation must be rejected; it must not
  // create or replace a second run marker. Recovery is inspect-only.
  const replay = await callCallable(callableUrl(), token, beginPayload);
  assert.notEqual(replay.status, 200, "replaying begin must not report success");
  const replayBody = await replay.json();
  assert.ok(replayBody.error, "replayed begin should return a callable error");
  const afterReplay = await runRef.get();
  assert.equal(afterReplay.id, runId);
  assert.equal(afterReplay.get("status"), "started");
  assert.equal(afterReplay.get("importedBy"), user.uid);
  assert.equal((await db.collection("service_location_import_runs").where("importedBy", "==", user.uid).get()).size, 1,
    "exactly one durable run marker should exist for this authenticated admin");
});
