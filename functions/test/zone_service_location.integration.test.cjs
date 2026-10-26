const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Zone callable tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}

const { GeoPoint, getFirestore } = require("firebase-admin/firestore");
const { activateServiceZone, saveServiceLocationWithNameIndex, setServiceLocationStatus } = require("../lib/index");
const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = Object.fromEntries([
  "admin", "support", "country", "state", "district", "city", "zone",
  "cityBoundary", "zoneBoundary", "outsideZone", "outsideBoundary", "createdZone",
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

async function save(uid, payload, locationId = ids.createdZone) {\n  return saveServiceLocationWithNameIndex.run({\n    ...(uid ? { auth: { uid, token: { uid } } } : {}),\n    data: { locationType: "zone", locationId, payload },\n  });\n}\nasync function activate(uid, zoneId = ids.zone) {
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
    `admin_users/${ids.admin}`, `admin_users/${ids.support}`,
    `service_countries/${ids.country}`, `service_states/${ids.state}`,
    `service_districts/${ids.district}`, `service_cities/${ids.city}`,
    `service_zones/${ids.zone}`, `service_zones/${ids.outsideZone}`, `service_zones/${ids.createdZone}`,
    `service_location_boundaries/${ids.cityBoundary}`,
    `service_location_boundaries/${ids.zoneBoundary}`,
    `service_location_boundaries/${ids.outsideBoundary}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    for (const collection of ["service_location_activation_audit", "service_location_status_audit"]) {
      const snap = await db.collection(collection).where("locationId", "in", [ids.zone, ids.outsideZone]).get().catch(() => ({ docs: [] }));
      await Promise.all(snap.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
    }
  });

  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ role: "super_admin", isActive: true }),
    db.doc(`admin_users/${ids.support}`).set({ role: "support", isActive: true }),
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
    const result = await save(ids.admin, {
      stateId: ids.state, districtId: ids.district, cityId: ids.city, name: "Saved Zone",
    });
    assert.equal(result.ok, true);
    const created = await db.doc(`service_zones/${ids.createdZone}`).get();
    assert.equal(created.exists, true);
    assert.equal(created.get("isServiceActive"), false);
    assert.equal(created.get("verifiedBoundaryId"), undefined);
  });

  await t.test("rejects unauthenticated and non-super-admin callers", async () => {
    await expectCode(activate(undefined), "unauthenticated");
    await expectCode(activate(ids.support), "permission-denied");
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
