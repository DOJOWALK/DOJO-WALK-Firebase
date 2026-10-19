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

test("recordPlan stores a bounded immutable canonical plan before location writes", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"1".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  const nodes = [
    { id: "state_1", type: "state", name: "Uttar Pradesh", parentId: "IN", alreadyExists: false, sourceLine: 2 },
    { id: "district_1", type: "district", name: "Gautam Buddha Nagar", parentId: "state_1", alreadyExists: false, sourceLine: 2 },
  ];
  const recorded = await manageServiceLocationImportRun.run(request(uid, {
    action: "recordPlan", runId, inputFingerprint: fingerprint, nodes,
  }));
  assert.equal(recorded.plannedRecords, 2);
  assert.match(recorded.planHash, /^[0-9a-f]{64}$/);
  const marker = await db.doc(`service_location_import_runs/${runId}`).get();
  assert.equal(marker.get("plannedRecords"), 2);
  assert.equal(marker.get("planHash"), recorded.planHash);
  const savedNodes = await db.collection(`service_location_import_runs/${runId}/planned_nodes`).get();
  assert.equal(savedNodes.size, 2);
  assert.equal(savedNodes.docs.find((doc) => doc.id === "district_1").get("parentId"), "state_1");
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      action: "recordPlan", runId, inputFingerprint: fingerprint, nodes,
    })),
    (error) => error && error.code === "already-exists",
  );
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      action: "recordPlan", runId, inputFingerprint: fingerprint,
      nodes: [{ ...nodes[0], id: "bad/id" }],
    })),
    (error) => error && error.code === "invalid-argument",
  );
});

test("reconcilePlan verifies the stored plan and hierarchy without writing", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"2".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  const nodes = [
    { id: "state_reconcile", type: "state", name: "Uttar Pradesh", parentId: "IN", alreadyExists: false, sourceLine: 2 },
    { id: "district_reconcile", type: "district", name: "Gautam Buddha Nagar", parentId: "state_reconcile", alreadyExists: false, sourceLine: 3 },
  ];
  await manageServiceLocationImportRun.run(request(uid, {
    action: "recordPlan", runId, inputFingerprint: fingerprint, nodes,
  }));
  const stateRef = db.doc("service_states/state_reconcile");
  const districtRef = db.doc("service_districts/district_reconcile");
  await stateRef.set({ name: "Uttar Pradesh", countryId: "IN" });
  await districtRef.set({ name: "Gautam Buddha Nagar", stateId: "state_reconcile" });
  const before = (await db.doc(`service_location_import_runs/${runId}`).get()).data();
  const result = await manageServiceLocationImportRun.run(request(uid, {
    action: "reconcilePlan", runId, inputFingerprint: fingerprint,
  }));
  assert.equal(result.status, "reconciled_match");
  assert.equal(result.matchingRecords, 2);
  assert.equal(result.readOnly, true);
  const after = (await db.doc(`service_location_import_runs/${runId}`).get()).data();
  assert.equal(after.status, before.status);
  assert.equal(after.updatedAt.isEqual(before.updatedAt), true);
  await districtRef.update({ stateId: "wrong_parent" });
  const mismatch = await manageServiceLocationImportRun.run(request(uid, {
    action: "reconcilePlan", runId, inputFingerprint: fingerprint,
  }));
  assert.equal(mismatch.status, "reconciliation_mismatch");
  assert.deepEqual(mismatch.mismatchIds, ["district_reconcile"]);
  await stateRef.delete();
  await districtRef.delete();
});

test("reconcilePlan reports incomplete plan and rejects fingerprint mismatch", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"3".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  await manageServiceLocationImportRun.run(request(uid, {
    action: "recordPlan", runId, inputFingerprint: fingerprint,
    nodes: [{ id: "state_incomplete", type: "state", name: "Rajasthan", parentId: "IN", alreadyExists: false, sourceLine: 2 }],
  }));
  const nodeRef = db.doc(`service_location_import_runs/${runId}/planned_nodes/state_incomplete`);
  await nodeRef.delete();
  const result = await manageServiceLocationImportRun.run(request(uid, {
    action: "reconcilePlan", runId, inputFingerprint: fingerprint,
  }));
  assert.equal(result.status, "plan_incomplete");
  await assert.rejects(
    () => manageServiceLocationImportRun.run(request(uid, {
      action: "reconcilePlan", runId, inputFingerprint: `sha256:${"4".repeat(64)}`,
    })),
    (error) => error && error.code === "failed-precondition",
  );
});

test("reconcilePlan verifies city and area parent links and reports missing descendants", async () => {
  const uid = await createAdmin();
  const runId = `run-${randomUUID()}`;
  runs.add(runId);
  const fingerprint = `sha256:${"5".repeat(64)}`;
  await manageServiceLocationImportRun.run(request(uid, payload(runId, fingerprint)));
  const nodes = [
    { id: "state_full", type: "state", name: "Rajasthan", parentId: "IN", alreadyExists: false, sourceLine: 2 },
    { id: "district_full", type: "district", name: "Jaipur", parentId: "state_full", alreadyExists: false, sourceLine: 3 },
    { id: "city_full", type: "city", name: "Jaipur City", parentId: "district_full", alreadyExists: false, sourceLine: 4 },
    { id: "area_full", type: "area", name: "Central Area", parentId: "city_full", alreadyExists: false, sourceLine: 5 },
  ];
  await manageServiceLocationImportRun.run(request(uid, {
    action: "recordPlan", runId, inputFingerprint: fingerprint, nodes,
  }));
  const refs = [
    db.doc("service_states/state_full"),
    db.doc("service_districts/district_full"),
    db.doc("service_cities/city_full"),
    db.doc("service_areas/area_full"),
  ];
  await refs[0].set({ name: "Rajasthan", countryId: "IN" });
  await refs[1].set({ name: "Jaipur", stateId: "state_full" });
  await refs[2].set({ name: "Jaipur City", districtId: "district_full" });
  await refs[3].set({ name: "Central Area", cityId: "city_full" });

  const matched = await manageServiceLocationImportRun.run(request(uid, {
    action: "reconcilePlan", runId, inputFingerprint: fingerprint,
  }));
  assert.equal(matched.status, "reconciled_match");
  assert.equal(matched.matchingRecords, 4);

  await refs[3].delete();
  const missing = await manageServiceLocationImportRun.run(request(uid, {
    action: "reconcilePlan", runId, inputFingerprint: fingerprint,
  }));
  assert.equal(missing.status, "reconciliation_mismatch");
  assert.deepEqual(missing.missingIds, ["area_full"]);
  for (const ref of refs) await ref.delete().catch(() => {});
});

test.after(async () => {
  for (const runId of runs) {
    await db.doc(`service_location_import_runs/${runId}`).delete().catch(() => {});
  }
  for (const uid of admins) {
    await db.doc(`admin_users/${uid}`).delete().catch(() => {});
  }
});
