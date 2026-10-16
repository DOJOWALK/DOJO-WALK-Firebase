const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// This suite must never run against a real Firestore project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Callable integration tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}

const { GeoPoint, getFirestore } = require("firebase-admin/firestore");
const { activateServiceLocation } = require("../lib/index");

const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = {
  ordinary: `it-ordinary-${suffix}`,
  inactive: `it-inactive-${suffix}`,
  admin: `it-admin-${suffix}`,
  city: `it-city-${suffix}`,
  area: `it-area-${suffix}`,
  invalidCity: `it-invalid-city-${suffix}`,
  cityBoundary: `it-city-boundary-${suffix}`,
  areaBoundary: `it-area-boundary-${suffix}`,
  invalidBoundary: `it-invalid-boundary-${suffix}`,
};

const polygonPoints = (south, west, north, east) => [
  new GeoPoint(south, west),
  new GeoPoint(south, east),
  new GeoPoint(north, east),
  new GeoPoint(north, west),
  new GeoPoint(south, west),
];

function boundary(locationId, locationType, points) {
  return {
    locationId,
    locationType,
    verificationStatus: "verified",
    sourceName: "Automated integration fixture",
    sourceReference: "test-fixture-only",
    verifiedBy: ids.admin,
    verifiedAt: new Date(),
    points,
  };
}

async function invoke(uid, locationType, locationId) {
  return activateServiceLocation.run({
    auth: { uid, token: { uid } },
    data: { locationType, locationId },
  });
}

async function expectCallableCode(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, expectedCode, `Expected callable error ${expectedCode}, got ${error.code}: ${error.message}`);
    return true;
  });
}

test("callable integration: auth, boundary validation, City and Area activation", async (t) => {
  // All test documents are isolated by a random suffix and removed afterwards.
  const docPaths = [
    `admin_users/${ids.ordinary}`,
    `admin_users/${ids.inactive}`,
    `admin_users/${ids.admin}`,
    `service_cities/${ids.city}`,
    `service_areas/${ids.area}`,
    `service_cities/${ids.invalidCity}`,
    `service_location_boundaries/${ids.cityBoundary}`,
    `service_location_boundaries/${ids.areaBoundary}`,
    `service_location_boundaries/${ids.invalidBoundary}`,
  ];
  t.after(async () => {
    await Promise.all(docPaths.map((path) => db.doc(path).delete().catch(() => undefined)));
    const audits = await db.collection("service_location_activation_audit")
      .where("actorUid", "==", ids.admin).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
  });

  await Promise.all([
    db.doc(`admin_users/${ids.inactive}`).set({ isActive: false, role: "super_admin" }),
    db.doc(`admin_users/${ids.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`service_cities/${ids.city}`).set({
      isServiceActive: false, verifiedBoundaryId: ids.cityBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.cityBoundary}`).set(
      boundary(ids.city, "city", polygonPoints(0, 0, 10, 10)),
    ),
    db.doc(`service_areas/${ids.area}`).set({
      isServiceActive: false, cityId: ids.city, verifiedBoundaryId: ids.areaBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.areaBoundary}`).set(
      boundary(ids.area, "area", polygonPoints(2, 2, 4, 4)),
    ),
    db.doc(`service_cities/${ids.invalidCity}`).set({
      isServiceActive: false, verifiedBoundaryId: ids.invalidBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.invalidBoundary}`).set({
      ...boundary(ids.invalidCity, "city", [new GeoPoint(0, 0), new GeoPoint(0, 0)]),
    }),
  ]);

  await t.test("unauthenticated caller is rejected", async () => {
    await assert.rejects(
      activateServiceLocation.run({ auth: undefined, data: { locationType: "city", locationId: ids.city } }),
      (error) => error.code === "unauthenticated",
    );
  });

  await t.test("ordinary authenticated user is rejected", async () => {
    await expectCallableCode(invoke(ids.ordinary, "city", ids.city), "permission-denied");
  });

  await t.test("inactive super_admin is rejected", async () => {
    await expectCallableCode(invoke(ids.inactive, "city", ids.city), "permission-denied");
  });

  await t.test("invalid verified boundary is rejected and location stays inactive", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.invalidCity), "failed-precondition");
    const location = await db.doc(`service_cities/${ids.invalidCity}`).get();
    assert.equal(location.get("isServiceActive"), false);
  });

  await t.test("active super_admin can activate a City with a valid verified boundary", async () => {
    const result = await invoke(ids.admin, "city", ids.city);
    assert.deepEqual(result, { ok: true, locationId: ids.city, locationType: "city" });
    assert.equal((await db.doc(`service_cities/${ids.city}`).get()).get("isServiceActive"), true);
  });

  await t.test("active super_admin can activate an Area contained by its active City", async () => {
    const result = await invoke(ids.admin, "area", ids.area);
    assert.deepEqual(result, { ok: true, locationId: ids.area, locationType: "area" });
    assert.equal((await db.doc(`service_areas/${ids.area}`).get()).get("isServiceActive"), true);
  });
});
