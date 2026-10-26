const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Zone callable tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}

const { GeoPoint, getFirestore } = require("firebase-admin/firestore");
const { activateServiceZone, reviewServiceLocationBoundary, saveServiceLocationWithNameIndex, setServiceLocationStatus } = require("../lib/index");
const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = Object.fromEntries([
  "admin", "support", "basicAdmin", "inactiveAdmin", "unknownRole", "country", "state", "district", "city", "zone",
  "cityBoundary", "zoneBoundary", "outsideZone", "outsideBoundary", "createdZone", "reviewZone", "reviewBoundary", "reviewOutsideBoundary",
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
    `admin_users/${ids.admin}`, `admin_users/${ids.support}`, `admin_users/${ids.basicAdmin}`, `admin_users/${ids.inactiveAdmin}`, `admin_users/${ids.unknownRole}`,
    `service_countries/${ids.country}`, `service_states/${ids.state}`,
    `service_districts/${ids.district}`, `service_cities/${ids.city}`,
    `service_zones/${ids.zone}`, `service_zones/${ids.outsideZone}`, `service_zones/${ids.createdZone}`, `service_zones/${ids.reviewZone}`,
    `service_location_boundaries/${ids.cityBoundary}`,
    `service_location_boundaries/${ids.zoneBoundary}`,
    `service_location_boundaries/${ids.outsideBoundary}`, `service_location_boundaries/${ids.reviewBoundary}`, `service_location_boundaries/${ids.reviewOutsideBoundary}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    for (const collection of ["service_location_activation_audit", "service_location_status_audit", "service_location_boundary_review_audit"]) {
      const snap = await db.collection(collection).where("locationId", "in", [ids.zone, ids.outsideZone, ids.reviewZone, ids.city]).get().catch(() => ({ docs: [] }));
      await Promise.all(snap.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
    }
  });

  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ role: "super_admin", isActive: true }),
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

  await t.test("Zone save requires Super Admin and validates State → District → City ancestry", async () => {
    await expectCode(save(ids.support, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "permission-denied");
    await expectCode(save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
      isServiceActive: true,
    }), "invalid-argument");
    await db.doc(`service_cities/${ids.city}`).update({ districtId: `wrong-district-${suffix}` });
    await expectCode(save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "failed-precondition");
    await db.doc(`service_cities/${ids.city}`).update({ districtId: ids.district });

    // Reject inconsistent Country ancestry during Zone save, not only later
    // during activation.
    const districtRef = db.doc(`service_districts/${ids.district}`);
    await districtRef.update({ countryId: `wrong-country-${suffix}` });
    await expectCode(save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "failed-precondition");
    await districtRef.update({ countryId: ids.country });

    const cityRef = db.doc(`service_cities/${ids.city}`);
    await cityRef.update({ countryId: `wrong-country-${suffix}` });
    await expectCode(save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    }), "failed-precondition");
    await cityRef.update({ countryId: ids.country });

    const result = await save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    });
    assert.equal(result.ok, true);
    const created = await db.doc(`service_zones/${ids.createdZone}`).get();
    assert.equal(created.exists, true);
    assert.equal(created.get("isServiceActive"), false);
    assert.equal(created.get("verifiedBoundaryId"), undefined);
  });

  await t.test("Zone boundary review verifies contained geometry and rejects outside geometry", async () => {
    const result = await reviewBoundary(ids.admin, ids.reviewBoundary);
    assert.equal(result.ok, true);
    assert.equal(result.decision, "verified");
    const reviewed = await db.doc(`service_location_boundaries/${ids.reviewBoundary}`).get();
    assert.equal(reviewed.get("verificationStatus"), "verified");
    assert.equal((await db.doc(`service_zones/${ids.reviewZone}`).get()).get("verifiedBoundaryId"), ids.reviewBoundary);

    await expectCode(reviewBoundary(ids.admin, ids.reviewOutsideBoundary), "failed-precondition");
    assert.equal((await db.doc(`service_location_boundaries/${ids.reviewOutsideBoundary}`).get()).get("verificationStatus"), "pending");
  });

  await t.test("rejects unauthenticated and non-super-admin callers", async () => {
    await expectCode(activate(undefined), "unauthenticated");
    await expectCode(activate(ids.support), "permission-denied");
  });

  await t.test("Zone save fails closed for missing, inactive, ordinary-admin and unknown-role actors", async () => {
    const payload = {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Authorization Test Zone",
    };
    await expectCode(save(undefined, payload), "unauthenticated");
    await expectCode(save(`missing-admin-${suffix}`, payload), "permission-denied");
    await expectCode(save(ids.inactiveAdmin, payload), "permission-denied");
    await expectCode(save(ids.basicAdmin, payload), "permission-denied");
    await expectCode(save(ids.unknownRole, payload), "permission-denied");
    assert.equal((await db.doc(`service_zones/${ids.createdZone}`).get()).exists, false);
  });

  await t.test("rejects Zone activation through generic status callable", async () => {
    await expectCode(status(ids.admin, "zone", ids.zone, true), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
  });

  await t.test("activates a verified Zone inside active City and writes activation audit", async () => {
    const result = await activate(ids.admin);
    assert.equal(result.ok, true);
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

  await t.test("rejects Zone polygon outside parent City", async () => {
    await expectCode(activate(ids.admin, ids.outsideZone), "failed-precondition");
    assert.equal((await db.doc(`service_zones/${ids.outsideZone}`).get()).get("isServiceActive"), false);
  });

  await t.test("rejects inactive privileged account and mismatched City ancestry", async () => {
    // The preceding happy-path test activated this Zone; reset it so this test
    // proves the failed ancestry check cannot activate an inactive Zone.
    await status(ids.admin, "zone", ids.zone, false);
    await db.doc(`admin_users/${ids.admin}`).update({ isActive: false });
    await expectCode(activate(ids.admin), "permission-denied");
    await db.doc(`admin_users/${ids.admin}`).update({ isActive: true });

    const cityRef = db.doc(`service_cities/${ids.city}`);
    // Country ancestry must match at both District and City levels.
    await cityRef.update({ countryId: `wrong-country-${suffix}` });
    await expectCode(activate(ids.admin), "failed-precondition");
    await cityRef.update({ countryId: ids.country });

    await db.doc(`service_districts/${ids.district}`).update({ countryId: `wrong-country-${suffix}` });
    await expectCode(activate(ids.admin), "failed-precondition");
    await db.doc(`service_districts/${ids.district}`).update({ countryId: ids.country });

    await cityRef.update({ districtId: `wrong-district-${suffix}` });
    await expectCode(activate(ids.admin), "failed-precondition");
    await cityRef.update({ districtId: ids.district });
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
  });


  await t.test("deactivates Zone through audited status callable", async () => {
    const result = await status(ids.admin, "zone", ids.zone, false);
    assert.equal(result.ok, true);
    assert.equal((await db.doc(`service_zones/${ids.zone}`).get()).get("isServiceActive"), false);
    const audit = await db.collection("service_location_status_audit")
      .where("locationId", "==", ids.zone).get();
    assert.ok(audit.docs.length > 0);
  });
});
