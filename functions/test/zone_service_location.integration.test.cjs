const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Zone callable tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}

const { GeoPoint, getFirestore } = require("firebase-admin/firestore");
const { activateServiceZone, reviewServiceLocationBoundary, saveServiceLocationWithNameIndex, setServiceLocationStatus, submitServiceZoneForFounderReview, decideServiceZoneFounderApproval, requestServiceZoneDeactivation, suspendServiceZoneForEmergency, requestServiceZoneReactivation } = require("../lib/index");
const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = Object.fromEntries([
  "admin", "central", "founder", "support", "basicAdmin", "inactiveAdmin", "unknownRole", "authTestZone", "country", "state", "district", "city", "zone",
  "cityBoundary", "zoneBoundary", "outsideZone", "outsideBoundary", "createdZone", "reviewZone", "reviewBoundary", "reviewOutsideBoundary", "suspendedBoundary", "emergencyNotification",
].map((key) => [key, `zone-it-${key}-${suffix}`]));

const points = (south, west, north, east) => [
  new GeoPoint(south, west),
  new GeoPoint(south, east),
  new GeoPoint(north, east),
  new GeoPoint(north, west),
  new GeoPoint(south, west),
];

function verifiedBoundary(locationId, locationType, polygonPoints) {
  return {
    locationId, locationType, points: polygonPoints,
    verificationStatus: "verified",
    sourceName: "Synthetic integration fixture",
    sourceReference: "TEST-ONLY",
    verifiedBy: ids.admin,
    verifiedAt: new Date(),
  };
}

async function save(uid, payload, locationId = ids.createdZone) {
  return saveServiceLocationWithNameIndex.run({
    ...(uid ? { auth: { uid, token: { uid } } } : {}),
    data: { locationType: "zone", locationId, payload },
  });
}
async function reviewBoundary(uid, boundaryId, decision = "verified") {
  return reviewServiceLocationBoundary.run({
    ...(uid ? { auth: { uid, token: { uid } } } : {}),
    data: { boundaryId, decision, notes: "Integration test review" },
  });
}
async function activate(uid, zoneId = ids.zone) {
  return activateServiceZone.run({
    ...(uid ? { auth: { uid, token: { uid } } } : {}),
    data: { zoneId },
  });
}
async function submitZone(uid, zoneId = ids.zone) {
  return submitServiceZoneForFounderReview.run({
    ...(uid ? { auth: { uid, token: { uid } } } : {}), data: { zoneId },
  });
}
async function approveZone(zoneId = ids.zone) {
  const ref = db.doc(`service_zones/${zoneId}`);
  const zone = await ref.get();
  await ref.set({ revision: zone.get("revision") || 1, workflowStatus: "draft" }, { merge: true });
  await submitZone(ids.central, zoneId);
  return decideServiceZoneFounderApproval.run({ auth: { uid: ids.founder, token: { uid: ids.founder } }, data: { zoneId, decision: "approve", notes: "Approved after review" } });
}
async function status(uid, locationType, locationId, isActive) {
  return setServiceLocationStatus.run({
    ...(uid ? { auth: { uid, token: { uid } } } : {}),
    data: { locationType, locationId, isActive },
  });
}
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `Expected ${code}; got ${error.code}: ${error.message}`);
    return true;
  });
}

test("Zone activation requires privileged auth, verified contained boundary and active ancestry; deactivation is audited", async (t) => {
  const paths = [
    `admin_users/${ids.admin}`, `admin_users/${ids.central}`, `admin_users/${ids.founder}`, `admin_users/${ids.support}`, `admin_users/${ids.basicAdmin}`, `admin_users/${ids.inactiveAdmin}`, `admin_users/${ids.unknownRole}`,
    `service_countries/${ids.country}`, `service_states/${ids.state}`,
    `service_districts/${ids.district}`, `service_cities/${ids.city}`,
    `service_zones/${ids.zone}`, `service_zones/${ids.outsideZone}`, `service_zones/${ids.createdZone}`, `service_zones/${ids.authTestZone}`, `service_zones/${ids.reviewZone}`,
    `service_location_boundaries/${ids.cityBoundary}`,
    `service_location_boundaries/${ids.zoneBoundary}`,
    `service_location_boundaries/${ids.outsideBoundary}`, `service_location_boundaries/${ids.reviewBoundary}`, `service_location_boundaries/${ids.reviewOutsideBoundary}`, `service_location_boundaries/${ids.suspendedBoundary}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    for (const collection of ["service_location_activation_audit", "service_location_status_audit", "service_location_boundary_review_audit", "service_zone_approval_audit"]) {
      const snap = await db.collection(collection).where("locationId", "in", [ids.zone, ids.outsideZone, ids.reviewZone, ids.city]).get().catch(() => ({ docs: [] }));
      await Promise.all(snap.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
    }
  });

  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ role: "super_admin", isActive: true }),
    db.doc(`admin_users/${ids.central}`).set({ role: "central_admin", isActive: true }),
    db.doc(`admin_users/${ids.founder}`).set({ role: "founder", isActive: true }),
    db.doc(`admin_users/${ids.support}`).set({ role: "support", isActive: true }),
    db.doc(`admin_users/${ids.basicAdmin}`).set({ role: "admin", isActive: true }),
    db.doc(`admin_users/${ids.inactiveAdmin}`).set({ role: "super_admin", isActive: false }),
    db.doc(`admin_users/${ids.unknownRole}`).set({ role: "mystery_role", isActive: true }),
    db.doc(`service_countries/${ids.country}`).set({ isActive: true }),
    db.doc(`service_states/${ids.state}`).set({ countryId: ids.country, isActive: true }),
    db.doc(`service_districts/${ids.district}`).set({ stateId: ids.state, countryId: ids.country, isServiceActive: true }),
    db.doc(`service_cities/${ids.city}`).set({
      stateId: ids.state, districtId: ids.district, countryId: ids.country,
      isServiceActive: true, verifiedBoundaryId: ids.cityBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.cityBoundary}`).set(
      verifiedBoundary(ids.city, "city", points(28.50, 77.30, 28.60, 77.40)),
    ),
    db.doc(`service_zones/${ids.zone}`).set({
      stateId: ids.state, districtId: ids.district, cityId: ids.city,
      isServiceActive: false, verifiedBoundaryId: ids.zoneBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.zoneBoundary}`).set(
      verifiedBoundary(ids.zone, "zone", points(28.52, 77.32, 28.54, 77.34)),
    ),
    db.doc(`service_zones/${ids.reviewZone}`).set({
      stateId: ids.state, districtId: ids.district, cityId: ids.city, isServiceActive: false,
    }),
    db.doc(`service_location_boundaries/${ids.reviewBoundary}`).set({
      ...verifiedBoundary(ids.reviewZone, "zone", points(28.52, 77.32, 28.54, 77.34)),
      verificationStatus: "pending",
    }),
    db.doc(`service_location_boundaries/${ids.reviewOutsideBoundary}`).set({
      ...verifiedBoundary(ids.reviewZone, "zone", points(28.55, 77.35, 28.62, 77.38)),
      verificationStatus: "pending",
    }),
    db.doc(`service_zones/${ids.outsideZone}`).set({
      stateId: ids.state, districtId: ids.district, cityId: ids.city,
      isServiceActive: false, verifiedBoundaryId: ids.outsideBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.outsideBoundary}`).set(
      verifiedBoundary(ids.outsideZone, "zone", points(28.55, 77.35, 28.62, 77.38)),
    ),
  ]);

  await t.test("Central Admin can create a draft Zone and ancestry is validated", async () => {
    await expectCode(save(ids.support, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "permission-denied");
    await expectCode(save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
      isServiceActive: true,
    }), "invalid-argument");
    await db.doc(`service_cities/${ids.city}`).update({ districtId: `wrong-district-${suffix}` });
    await expectCode(save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "failed-precondition");
    await db.doc(`service_cities/${ids.city}`).update({ districtId: ids.district });

    // Reject inconsistent Country ancestry during Zone save, not only later
    // during activation.
    const districtRef = db.doc(`service_districts/${ids.district}`);
    await districtRef.update({ countryId: `wrong-country-${suffix}` });
    await expectCode(save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "failed-precondition");
    await districtRef.update({ countryId: ids.country });

    const cityRef = db.doc(`service_cities/${ids.city}`);
    await cityRef.update({ countryId: `wrong-country-${suffix}` });
    await expectCode(save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "failed-precondition");
    await cityRef.update({ countryId: ids.country });

    const result = await save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    });
    assert.equal(result.ok, true);
    const created = await db.doc(`service_zones/${ids.createdZone}`).get();
    assert.equal(created.exists, true);
    assert.equal(created.get("isServiceActive"), false);
    assert.equal(created.get("verifiedBoundaryId"), undefined);
    assert.equal(created.get("workflowStatus"), "draft");
    assert.equal(created.get("revision"), 1);
    await expectCode(save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Super Admin draft",
    }), "permission-denied");
  });

  await t.test("Super Admin cannot review a Zone boundary; Central Admin owns boundary operations", async () => {
    await expectCode(reviewBoundary(ids.admin, ids.reviewBoundary), "permission-denied");
    assert.equal((await db.doc(`service_location_boundaries/${ids.reviewBoundary}`).get()).get("verificationStatus"), "pending");
  });

  await t.test("Zone boundary review verifies containment without requiring an active City", async () => {
    const cityRef = db.doc(`service_cities/${ids.city}`);
    await cityRef.update({ isServiceActive: false });
    try {
      const result = await reviewBoundary(ids.central, ids.reviewBoundary);
      assert.equal(result.ok, true);
      assert.equal(result.decision, "verified");
      const reviewed = await db.doc(`service_location_boundaries/${ids.reviewBoundary}`).get();
      assert.equal(reviewed.get("verificationStatus"), "verified");
      assert.equal((await db.doc(`service_zones/${ids.reviewZone}`).get()).get("verifiedBoundaryId"), ids.reviewBoundary);

      await expectCode(reviewBoundary(ids.central, ids.reviewOutsideBoundary), "failed-precondition");
      assert.equal((await db.doc(`service_location_boundaries/${ids.reviewOutsideBoundary}`).get()).get("verificationStatus"), "pending");
    } finally {
      await cityRef.update({ isServiceActive: true });
    }
  });

  await t.test("rejects unauthenticated and non-super-admin callers", async () => {
    await expectCode(activate(undefined), "unauthenticated");
    await expectCode(activate(ids.support), "permission-denied");
  });

  await t.test("Zone save fails closed for missing, inactive, ordinary-admin and unknown-role actors", async () => {
    const payload = {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Authorization Test Zone",
    };
    await expectCode(save(undefined, payload, ids.authTestZone), "unauthenticated");
    await expectCode(save(`missing-admin-${suffix}`, payload, ids.authTestZone), "permission-denied");
    await expectCode(save(ids.inactiveAdmin, payload, ids.authTestZone), "permission-denied");
    await expectCode(save(ids.basicAdmin, payload, ids.authTestZone), "permission-denied");
    await expectCode(save(ids.unknownRole, payload, ids.authTestZone), "permission-denied");
    assert.equal((await db.doc(`service_zones/${ids.authTestZone}`).get()).exists, false);
  });

  await t.test("rejects Zone activation through generic status callable", async () => {
    await expectCode(status(ids.admin, "zone", ids.zone, true), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
  });

  await t.test("Founder approval cannot be bypassed by Central Admin or technical Super Admin", async () => {
    await expectCode(submitZone(ids.admin, ids.zone), "permission-denied");
    await expectCode(decideServiceZoneFounderApproval.run({
      auth: { uid: ids.admin, token: { uid: ids.admin } },
      data: { zoneId: ids.zone, decision: "approve", notes: "Must be denied" },
    }), "permission-denied");
    await expectCode(decideServiceZoneFounderApproval.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, decision: "approve", notes: "Self approval must be denied" },
    }), "permission-denied");
    await expectCode(activate(ids.central, ids.zone), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
    await db.doc(`admin_users/${ids.founder}`).update({ isActive: false });
    await expectCode(decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.zone, decision: "approve", notes: "Inactive Founder must be denied" },
    }), "permission-denied");
    await db.doc(`admin_users/${ids.founder}`).update({ isActive: true });
  });

  await t.test("standard submission and Founder decision replays are rejected", async () => {
    await submitZone(ids.central, ids.reviewZone);
    await expectCode(submitZone(ids.central, ids.reviewZone), "already-exists");
    const decision = () => decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.reviewZone, decision: "approve", notes: "Replay audit test" },
    });
    const approved = await decision();
    assert.equal(approved.workflowStatus, "approved");
    await expectCode(decision(), "failed-precondition");
  });

  await t.test("stale boundary hash invalidates Founder approval", async () => {
    await approveZone(ids.reviewZone);
    const boundaryRef = db.doc(`service_location_boundaries/${ids.reviewBoundary}`);
    const boundary = await boundaryRef.get();
    const originalPoints = boundary.get("points");
    await boundaryRef.update({ points: points(28.521, 77.321, 28.541, 77.341) });
    await expectCode(activate(ids.central, ids.reviewZone), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.reviewZone}`).get()).get("isServiceActive"), false);
    await boundaryRef.update({ points: originalPoints });
  });

  await t.test("Founder cannot decide a submission after its boundary changes", async () => {
    await submitZone(ids.central, ids.reviewZone);
    const boundaryRef = db.doc(`service_location_boundaries/${ids.reviewBoundary}`);
    const before = await boundaryRef.get();
    const originalPoints = before.get("points");
    try {
      await boundaryRef.update({ points: points(28.522, 77.322, 28.542, 77.342) });
      await expectCode(decideServiceZoneFounderApproval.run({
        auth: { uid: ids.founder, token: { uid: ids.founder } },
        data: { zoneId: ids.reviewZone, decision: "approve", notes: "Stale submission must be rejected" },
      }), "failed-precondition");
      const unchanged = await db.doc(`service_zones/${ids.reviewZone}`).get();
      assert.equal(unchanged.get("workflowStatus"), "submitted");
      assert.equal(unchanged.get("approvalUid"), undefined);
    } finally {
      await boundaryRef.update({ points: originalPoints });
    }
    // Restore the fixture to an approved state for the following revision test.
    await approveZone(ids.reviewZone);
  });

  await t.test("Zone revision changes invalidate an otherwise valid Founder approval", async () => {
    const zoneRef = db.doc(`service_zones/${ids.reviewZone}`);
    const before = await zoneRef.get();
    const currentRevision = before.get("revision");
    assert.equal(before.get("workflowStatus"), "approved");
    assert.equal(before.get("approvedRevision"), currentRevision);
    await zoneRef.update({ revision: currentRevision + 1 });
    await expectCode(activate(ids.central, ids.reviewZone), "failed-precondition");
    const after = await zoneRef.get();
    assert.equal(after.get("isServiceActive"), false);
    assert.equal(after.get("approvedRevision"), currentRevision);
    assert.notEqual(after.get("approvedRevision"), after.get("revision"));
  });

  await t.test("activates a verified Zone without parent service-active flags and writes activation audit", async () => {
    await Promise.all([
      db.doc(`service_states/${ids.state}`).update({ isActive: false }),
      db.doc(`service_districts/${ids.district}`).update({ isServiceActive: false }),
      db.doc(`service_cities/${ids.city}`).update({ isServiceActive: false }),
    ]);
    await approveZone(ids.zone);
    const result = await activate(ids.central);
    assert.equal(result.ok, true);
    await Promise.all([
      db.doc(`service_states/${ids.state}`).update({ isActive: true }),
      db.doc(`service_districts/${ids.district}`).update({ isServiceActive: true }),
      db.doc(`service_cities/${ids.city}`).update({ isServiceActive: true }),
    ]);
    assert.equal(result.locationType, "zone");
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), true);
    assert.ok((await db.doc(`service_countries/${ids.country}`).get()).get("activationGuardAt"));
    assert.ok((await db.doc(`service_states/${ids.state}`).get()).get("activationGuardAt"));
    assert.ok((await db.doc(`service_districts/${ids.district}`).get()).get("activationGuardAt"));
    assert.ok((await db.doc(`service_cities/${ids.city}`).get()).get("activationGuardAt"));
    // Country deactivation must also respect active State descendants.
    await expectCode(status(ids.admin, "country", ids.country, false), "failed-precondition");
    assert.equal((await db.doc(`service_countries/${ids.country}`).get()).get("isActive"), true);
    // A City cannot be deactivated while an active Zone still depends on it.
    // The City has no legacy active Area in this fixture, so this specifically
    // exercises the canonical Zone-descendant guard.
    await expectCode(status(ids.admin, "city", ids.city, false), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.city}`).get()).get("isServiceActive"), true);

    // Isolate ancestor guards from ordinary active-child checks. Simulate
    // stale legacy data where City and then State are already marked inactive
    // but the canonical Zone remains active.
    await db.doc(`service_cities/${ids.city}`).update({ isServiceActive: false });
    await db.doc(`service_states/${ids.state}`).update({ isActive: false });
    await expectCode(status(ids.admin, "country", ids.country, false), "failed-precondition");
    assert.equal((await db.doc(`service_countries/${ids.country}`).get()).get("isActive"), true);
    await db.doc(`service_states/${ids.state}`).update({ isActive: true });
    await expectCode(status(ids.admin, "district", ids.district, false), "failed-precondition");
    await expectCode(status(ids.admin, "state", ids.state, false), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), true);
    await db.doc(`service_cities/${ids.city}`).update({ isServiceActive: true });

    const audit = await db.collection("service_location_activation_audit")
      .where("locationId", "==", ids.zone).get();
    assert.ok(audit.docs.some((doc) => doc.get("result") === "activated" && doc.get("locationType") === "zone"));
  });

  await t.test("rejects service status changes for every non-Zone location type", async () => {
    const legacyAndParentTypes = [
      ["country", ids.country],
      ["state", ids.state],
      ["district", ids.district],
      ["city", ids.city],
      ["area", ids.city],
      ["locality", ids.city],
    ];
    for (const [locationType, locationId] of legacyAndParentTypes) {
      await expectCode(status(ids.admin, locationType, locationId, true), "failed-precondition");
      await expectCode(status(ids.admin, locationType, locationId, false), "failed-precondition");
    }
    assert.equal((await db.doc(`service_countries/${ids.country}`).get()).get("isActive"), true);
    assert.equal((await db.doc(`service_states/${ids.state}`).get()).get("isActive"), true);
    assert.equal((await db.doc(`service_districts/${ids.district}`).get()).get("isServiceActive"), true);
    assert.equal((await db.doc(`service_cities/${ids.city}`).get()).get("isServiceActive"), true);
  });

  await t.test("rejects Zone polygon outside parent City", async () => {
    await expectCode(activate(ids.central, ids.outsideZone), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.outsideZone}`).get()).get("isServiceActive"), false);
  });

  await t.test("rejects inactive privileged account and mismatched City ancestry", async () => {
    // The preceding happy-path test activated this Zone; reset it so this test
    // proves the failed ancestry check cannot activate an inactive Zone.
    await requestServiceZoneDeactivation.run({ auth: { uid: ids.central, token: { uid: ids.central } }, data: { zoneId: ids.zone, notes: "Test deactivation request" } });
    await expectCode(requestServiceZoneDeactivation.run({ auth: { uid: ids.central, token: { uid: ids.central } }, data: { zoneId: ids.zone, notes: "Duplicate request must be rejected" } }), "failed-precondition");
    const deactivationChanges = await decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.zone, decision: "changes_required", notes: "Please clarify the service continuity plan." },
    });
    assert.equal(deactivationChanges.workflowStatus, "active");
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), true);
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("approvedRevision"), 1);
    await expectCode(decideServiceZoneFounderApproval.run({ auth: { uid: ids.founder, token: { uid: ids.founder } }, data: { zoneId: ids.zone, decision: "changes_required", notes: "Replay of old decision must fail" } }), "failed-precondition");
    await requestServiceZoneDeactivation.run({ auth: { uid: ids.central, token: { uid: ids.central } }, data: { zoneId: ids.zone, notes: "Updated deactivation request after clarification" } });
    await decideServiceZoneFounderApproval.run({ auth: { uid: ids.founder, token: { uid: ids.founder } }, data: { zoneId: ids.zone, decision: "deactivate", notes: "Founder approved deactivation for test" } });
    const zoneBoundaryRef = db.doc(`service_location_boundaries/${ids.zoneBoundary}`);
    const zoneBoundaryBefore = await zoneBoundaryRef.get();
    const originalZonePoints = zoneBoundaryBefore.get("points");
    await zoneBoundaryRef.update({ points: points(28.521, 77.321, 28.541, 77.341) });
    await expectCode(status(ids.central, "zone", ids.zone, false), "failed-precondition");
    await zoneBoundaryRef.update({ points: originalZonePoints });
    await status(ids.central, "zone", ids.zone, false);
    await expectCode(decideServiceZoneFounderApproval.run({ auth: { uid: ids.founder, token: { uid: ids.founder } }, data: { zoneId: ids.zone, decision: "deactivate", notes: "Replay after deactivation must fail" } }), "failed-precondition");
    await db.doc(`admin_users/${ids.central}`).update({ isActive: false });
    await expectCode(activate(ids.central), "permission-denied");
    await db.doc(`admin_users/${ids.central}`).update({ isActive: true });

    const cityRef = db.doc(`service_cities/${ids.city}`);
    // Country ancestry must match at both District and City levels.
    await cityRef.update({ countryId: `wrong-country-${suffix}` });
    await expectCode(activate(ids.central), "failed-precondition");
    await cityRef.update({ countryId: ids.country });

    await db.doc(`service_districts/${ids.district}`).update({ countryId: `wrong-country-${suffix}` });
    await expectCode(activate(ids.central), "failed-precondition");
    await db.doc(`service_districts/${ids.district}`).update({ countryId: ids.country });

    await cityRef.update({ districtId: `wrong-district-${suffix}` });
    await expectCode(activate(ids.central), "failed-precondition");
    await cityRef.update({ districtId: ids.district });
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
  });


  await t.test("deactivates Zone through audited status callable", async () => {
    const result = await status(ids.central, "zone", ids.zone, false);
    assert.equal(result.ok, true);
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
    const audit = await db.collection("service_location_status_audit")
      .where("locationId", "==", ids.zone).get();
    assert.ok(audit.docs.length > 0);
  });

  await t.test("Central Admin can emergency-suspend a Zone with reason, audit and Founder inbox notification", async () => {
    const zoneRef = db.doc(`service_zones/${ids.zone}`);
    await zoneRef.set({ isServiceActive: true, workflowStatus: "active", revision: 7, approvedRevision: 7, approvedBoundaryHash: "old-hash", approvalUid: ids.founder }, { merge: true });
    const result = await suspendServiceZoneForEmergency.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "Safety incident reported; stop new service immediately.", severity: "SEV-1" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.workflowStatus, "suspended");
    assert.equal(result.founderNotificationQueued, true);
    const suspended = await zoneRef.get();
    assert.equal(suspended.get("isServiceActive"), false);
    assert.equal(suspended.get("workflowStatus"), "suspended");
    assert.equal(suspended.get("approvedRevision"), undefined);
    assert.equal(suspended.get("emergencySuspensionSeverity"), "SEV-1");
    const suspendedRevision = suspended.get("revision");
    await expectCode(save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Attempt to bypass reactivation",
    }, ids.zone), "failed-precondition");
    const stillSuspended = await zoneRef.get();
    assert.equal(stillSuspended.get("workflowStatus"), "suspended");
    assert.equal(stillSuspended.get("revision"), suspendedRevision);
    const suspendedBoundaryRef = db.doc(`service_location_boundaries/${ids.suspendedBoundary}`);
    await suspendedBoundaryRef.set({
      locationId: ids.zone, locationType: "zone", points: points(0.2, 0.2, 0.3, 0.3),
      verificationStatus: "pending", sourceName: "Suspended-boundary bypass test", sourceReference: "TEST-ONLY",
    });
    await expectCode(reviewBoundary(ids.central, ids.suspendedBoundary, "verified"), "failed-precondition");
    assert.equal((await zoneRef.get()).get("workflowStatus"), "suspended");
    assert.equal((await zoneRef.get()).get("revision"), suspendedRevision);
    assert.equal((await suspendedBoundaryRef.get()).get("verificationStatus"), "pending");
    const notificationsBeforeReplay = await db.collection("founder_notifications")
      .where("zoneId", "==", ids.zone).where("notificationType", "==", "emergency_zone_suspension").get();
    const replaySuspension = await suspendServiceZoneForEmergency.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "Duplicate request must not create another incident.", severity: "SEV-1" },
    });
    assert.equal(replaySuspension.alreadySuspended, true);
    const notificationsAfterReplay = await db.collection("founder_notifications")
      .where("zoneId", "==", ids.zone).where("notificationType", "==", "emergency_zone_suspension").get();
    assert.equal(notificationsAfterReplay.size, notificationsBeforeReplay.size);
    const audit = await db.collection("service_zone_approval_audit").where("zoneId", "==", ids.zone).where("action", "==", "emergency_suspended").get();
    assert.ok(audit.docs.some((doc) => doc.get("actorUid") === ids.central));
    const notifications = await db.collection("founder_notifications").where("zoneId", "==", ids.zone).where("notificationType", "==", "emergency_zone_suspension").get();
    assert.ok(notifications.docs.some((doc) => doc.get("targetRole") === "founder" && doc.get("status") === "unread"));
    await expectCode(activate(ids.central, ids.zone), "failed-precondition");
    await expectCode(suspendServiceZoneForEmergency.run({
      auth: { uid: ids.admin, token: { uid: ids.admin } },
      data: { zoneId: ids.zone, reason: "Unauthorized attempt", severity: "SEV-1" },
    }), "permission-denied");
    await expectCode(suspendServiceZoneForEmergency.run({
      auth: { uid: ids.inactiveAdmin, token: { uid: ids.inactiveAdmin } },
      data: { zoneId: ids.zone, reason: "Inactive account must not suspend", severity: "SEV-1" },
    }), "permission-denied");
    await expectCode(suspendServiceZoneForEmergency.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "Missing severity must be rejected." },
    }), "invalid-argument");
    await expectCode(suspendServiceZoneForEmergency.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "   ", severity: "SEV-2" },
    }), "invalid-argument");
    await expectCode(suspendServiceZoneForEmergency.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "Invalid severity test", severity: "SEV-5" },
    }), "invalid-argument");
    await expectCode(suspendServiceZoneForEmergency.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.createdZone, reason: "A draft Zone must not be emergency-suspended.", severity: "SEV-2" },
    }), "failed-precondition");

    await expectCode(activate(ids.central, ids.zone), "failed-precondition");
    const reactivation = await requestServiceZoneReactivation.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "Safety review completed; requesting fresh approval." },
    });
    assert.equal(reactivation.workflowStatus, "reactivation_submitted");
    assert.equal(reactivation.revision, 8);
    await expectCode(save(ids.central, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Attempt to edit submitted reactivation",
    }, ids.zone), "failed-precondition");
    const stillSubmittedReactivation = await zoneRef.get();
    assert.equal(stillSubmittedReactivation.get("workflowStatus"), "reactivation_submitted");
    assert.equal(stillSubmittedReactivation.get("revision"), 8);
    await expectCode(reviewBoundary(ids.central, ids.suspendedBoundary, "verified"), "failed-precondition");
    assert.equal((await zoneRef.get()).get("workflowStatus"), "reactivation_submitted");
    assert.equal((await db.doc(`service_location_boundaries/${ids.suspendedBoundary}`).get()).get("verificationStatus"), "pending");
    // The ordinary approval submission must not downgrade reactivation_submitted
    // to submitted, otherwise Founder could use generic "approve" instead of
    // the required explicit "reactivate" decision.
    await expectCode(submitServiceZoneForFounderReview.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone },
    }), "failed-precondition");
    assert.equal((await zoneRef.get()).get("workflowStatus"), "reactivation_submitted");
    await expectCode(activate(ids.central, ids.zone), "failed-precondition");
    const reactivationChanges = await decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.zone, decision: "changes_required", notes: "Attach the completed safety review." },
    });
    assert.equal(reactivationChanges.workflowStatus, "suspended");
    assert.equal((await zoneRef.get()).get("isServiceActive"), false);
    const resubmittedReactivation = await requestServiceZoneReactivation.run({
      auth: { uid: ids.central, token: { uid: ids.central } },
      data: { zoneId: ids.zone, reason: "Safety review attached; requesting approval again." },
    });
    assert.equal(resubmittedReactivation.workflowStatus, "reactivation_submitted");
    assert.equal(resubmittedReactivation.revision, 9);
    const founderDecision = await decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.zone, decision: "reactivate", notes: "Reviewed safety evidence; reactivation approved." },
    });
    assert.equal(founderDecision.workflowStatus, "approved");
    // Founder decisions are bound to the current submitted workflow state; replaying the same approval must fail.
    await expectCode(decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.zone, decision: "reactivate", notes: "Replay attempt must be rejected." },
    }), "failed-precondition");
    await expectCode(decideServiceZoneFounderApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { zoneId: ids.zone, decision: "approve", notes: "Wrong workflow decision must be rejected." },
    }), "failed-precondition");
    const reactivated = await activate(ids.central, ids.zone);
    assert.equal(reactivated.ok, true);
    assert.equal((await zoneRef.get()).get("isServiceActive"), true);
  });
});
