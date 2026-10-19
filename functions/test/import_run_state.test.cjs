const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { manageServiceLocationImportRun } = require("../lib/index");

const db = getFirestore();
const admins = new Set();
const runs = new Set();

function request(uid, data) {
  return {
    data,
    auth: uid ? { uid, token: { uid } } : undefined,
    rawRequest: {},
    acceptsStreaming: false,
  };
}

async function createAdmin(role = "super_admin", isActive = true) {
  const uid = `import-run-test-${randomUUID()}`;
  admins.add(uid);
  await db.doc(`admin_users/${uid}`).set({ role, isActive });
  return uid;
}

function payload(runId, fingerprint, action = "begin", extra = {}) {
  return {
    action,
    runId,
    inputFingerprint: fingerprint,
    ...(action === "begin" ? { countryId: "IN", fileName: "states.csv" } : {}),
    ...extra,
  };
}

test("import run requires authentication and active super_admin", async () => {
  const runId = `run-${randomUUID()}`;
  const fingerprint = `sha256:${"a".repeat(64)}`;
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(undefined, payload(runId, fingerprint))),
    (error) => error && error.code === "unauthenticated",
  );
  const admin = await createAdmin("admin", true);
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(admin, payload(runId, fingerprint))),
    (error) => error && error.code === "permission-denied",
  );
  assert.equal((await db.doc(`service_location_import_runs/${runId}`).get()).exists, false);
});

test("begin persists a started marker before writes and blocks duplicate run IDs", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"b".repeat(64)}`;
  const result = await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  assert.equal(result.status, "started");
  const saved = await db.doc(`service_location_import_runs/${runId}`).get();
  assert.equal(saved.get("status"), "started");
  assert.equal(saved.get("importedBy"), uid);
  assert.equal(saved.get("inputFingerprint"), fingerprint);

  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint))),
    (error) => error && error.code === "already-exists",
  );
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, payload(runId, `sha256:${"c".repeat(64)}`))),
    (error) => error && error.code === "failed-precondition",
  );
});

test("inspect returns durable run status only for a matching fingerprint", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"9".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  const inspected = await manageServiceLocationImportRun.run(request(uid, {
    action: "inspect", runId, inputFingerprint: fingerprint,
  }));
  assert.equal(inspected.runId, runId);
  assert.equal(inspected.status, "started");
  assert.equal(inspected.reconciliationRequired, true);
  assert.equal(inspected.inputFingerprint, fingerprint);
  assert.equal("secret" in inspected, false);
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      action: "inspect", runId, inputFingerprint: `sha256:${"8".repeat(64)}`,
    })),
    (error) => error && error.code === "failed-precondition",
  );
});

test("finalize checks owner and fingerprint, then permits only idempotent same-result retry", async () => {
  const uid = await createAdmin();
  const other = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"d".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  const finalize = payload(runId, fingerprint, "finalize", {
    status: "completed", plannedRecords: 4, createdRecords: 3, reusedRecords: 1,
  });

  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(other, finalize)),
    (error) => error && error.code === "failed-precondition",
  );
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      ...finalize, inputFingerprint: `sha256:${"e".repeat(64)}`,
    })),
    (error) => error && error.code === "failed-precondition",
  );

  const completed = await manageServiceLocationImportRun.run(request(uid, finalize));
  assert.equal(completed.status, "completed");
  const retry = await manageServiceLocationImportRun.run(request(uid, finalize));
  assert.equal(retry.alreadyFinalized, true);
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      ...finalize, status: "failed",
    })),
    (error) => error && error.code === "failed-precondition",
  );
  const saved = await db.doc(`service_location_import_runs/${runId}`).get();
  assert.equal(saved.get("status"), "completed");
  assert.equal(saved.get("plannedRecords"), 4);
});

test("finalize rejects invalid or inconsistent counts and unknown actions", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"f".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint, "finalize", {
      status: "completed", plannedRecords: -1, createdRecords: 0, reusedRecords: 0,
    }))),
    (error) => error && error.code === "invalid-argument",
  );
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint, "finalize", {
      status: "completed", plannedRecords: 4, createdRecords: 2, reusedRecords: 1,
    }))),
    (error) => error && error.code === "invalid-argument",
  );
  const saved = await db.doc(`service_location_import_runs/${runId}`).get();
  assert.equal(saved.get("status"), "started", "invalid summary must not finalize the durable run");
  const partial = await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint, "finalize", {
    status: "partial_failure", plannedRecords: 4, createdRecords: 2, reusedRecords: 0,
  })));
  assert.equal(partial.status, "partial_failure", "partial failures may account for only the writes completed so far");
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      action: "delete", runId, inputFingerprint: fingerprint,
    })),
    (error) => error && error.code === "invalid-argument",
  );
});

test.after(async () => {
  for (const runId of runs) {
    await db.doc(`service_location_import_runs/${runId}`).delete().catch(() => {});
  }
  for (const uid of admins) {
    await db.doc(`admin_users/${uid}`).delete().catch(() => {});
  }
});
