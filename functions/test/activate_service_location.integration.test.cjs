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
  country: `it-country-${suffix}`,
  state: `it-state-${suffix}`,
  otherCountry: `it-other-country-${suffix}`,
  inactiveState: `it-inactive-state-${suffix}`,
  mismatchedState: `it-mismatched-state-${suffix}`,
  city: `it-city-${suffix}`,
  district: `it-district-${suffix}`,
  districtCity: `it-district-city-${suffix}`,
  districtCityBoundary: `it-district-city-boundary-${suffix}`,
  area: `it-area-${suffix}`,
  invalidCity: `it-invalid-city-${suffix}`,
  cityBoundary: `it-city-boundary-${suffix}`,
  areaBoundary: `it-area-boundary-${suffix}`,
  invalidBoundary: `it-invalid-boundary-${suffix}`,
  invalidTimestampCity: `it-invalid-timestamp-city-${suffix}`,
  invalidTimestampBoundary: `it-invalid-timestamp-boundary-${suffix}`,
  invalidBoundaryIdCity: `it-invalid-boundary-id-city-${suffix}`,
  noBoundaryCity: `it-no-boundary-city-${suffix}`,
  wrongTypeCity: `it-wrong-type-city-${suffix}`,
  wrongTypeBoundary: `it-wrong-type-boundary-${suffix}`,
  missingStateCity: `it-missing-state-city-${suffix}`,
  missingStateBoundary: `it-missing-state-boundary-${suffix}`,
  inactiveStateCity: `it-inactive-state-city-${suffix}`,
  inactiveStateBoundary: `it-inactive-state-boundary-${suffix}`,
  mismatchedStateCity: `it-mismatched-state-city-${suffix}`,
  mismatchedStateBoundary: `it-mismatched-state-boundary-${suffix}`,
  inactiveParentCity: `it-inactive-parent-city-${suffix}`,
  inactiveParentArea: `it-inactive-parent-area-${suffix}`,
  inactiveParentAreaBoundary: `it-inactive-parent-area-boundary-${suffix}`,
  outsideArea: `it-outside-area-${suffix}`,
  outsideAreaBoundary: `it-outside-area-boundary-${suffix}`,
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
    `service_countries/${ids.country}`,
    `service_states/${ids.state}`,
    `service_countries/${ids.otherCountry}`,
    `service_states/${ids.inactiveState}`,
    `service_states/${ids.mismatchedState}`,
    `service_cities/${ids.city}`,
    `service_districts/${ids.district}`,
    `service_cities/${ids.districtCity}`,
    `service_location_boundaries/${ids.districtCityBoundary}`,
    `service_areas/${ids.area}`,
    `service_cities/${ids.invalidCity}`,
    `service_location_boundaries/${ids.cityBoundary}`,
    `service_location_boundaries/${ids.areaBoundary}`,
    `service_location_boundaries/${ids.invalidBoundary}`,
    `service_cities/${ids.invalidTimestampCity}`,
    `service_cities/${ids.invalidBoundaryIdCity}`,
    `service_location_boundaries/${ids.invalidTimestampBoundary}`,
    `service_cities/${ids.noBoundaryCity}`,
    `service_cities/${ids.wrongTypeCity}`,
    `service_cities/${ids.missingStateCity}`,
    `service_location_boundaries/${ids.missingStateBoundary}`,
    `service_cities/${ids.inactiveStateCity}`,
    `service_location_boundaries/${ids.inactiveStateBoundary}`,
    `service_cities/${ids.mismatchedStateCity}`,
    `service_location_boundaries/${ids.mismatchedStateBoundary}`,
    `service_location_boundaries/${ids.wrongTypeBoundary}`,
    `service_cities/${ids.inactiveParentCity}`,
    `service_areas/${ids.inactiveParentArea}`,
    `service_location_boundaries/${ids.inactiveParentAreaBoundary}`,
    `service_areas/${ids.outsideArea}`,
    `service_location_boundaries/${ids.outsideAreaBoundary}`,
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
    db.doc(`service_countries/${ids.country}`).set({ isActive: true }),
    db.doc(`service_states/${ids.state}`).set({ countryId: ids.country, isActive: true }),
    db.doc(`service_countries/${ids.otherCountry}`).set({ isActive: true }),
    db.doc(`service_states/${ids.inactiveState}`).set({ countryId: ids.country, isActive: false }),
    db.doc(`service_states/${ids.mismatchedState}`).set({ countryId: ids.otherCountry, isActive: true }),
    db.doc(`service_cities/${ids.city}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state, verifiedBoundaryId: ids.cityBoundary,
    }),
    db.doc(`service_districts/${ids.district}`).set({
      countryId: ids.country, stateId: ids.state, isServiceActive: false,
    }),
    db.doc(`service_cities/${ids.districtCity}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state,
      districtId: ids.district, verifiedBoundaryId: ids.districtCityBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.districtCityBoundary}`).set(
      boundary(ids.districtCity, "city", polygonPoints(0, 0, 10, 10)),
    ),
    db.doc(`service_location_boundaries/${ids.cityBoundary}`).set(
      boundary(ids.city, "city", polygonPoints(0, 0, 10, 10)),
    ),
    db.doc(`service_areas/${ids.area}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state, cityId: ids.city, verifiedBoundaryId: ids.areaBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.areaBoundary}`).set(
      boundary(ids.area, "area", polygonPoints(2, 2, 4, 4)),
    ),
    db.doc(`service_cities/${ids.invalidCity}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state, verifiedBoundaryId: ids.invalidBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.invalidBoundary}`).set({
      ...boundary(ids.invalidCity, "city", [new GeoPoint(0, 0), new GeoPoint(0, 0)]),
    }),
    db.doc(`service_cities/${ids.invalidTimestampCity}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state,
      verifiedBoundaryId: ids.invalidTimestampBoundary,
    }),
    db.doc(`service_cities/${ids.invalidBoundaryIdCity}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state,
      verifiedBoundaryId: "../bad-id",
    }),
    db.doc(`service_location_boundaries/${ids.invalidTimestampBoundary}`).set({
      ...boundary(ids.invalidTimestampCity, "city", polygonPoints(0, 0, 10, 10)),
      verifiedAt: "verified-yesterday",
    }),
    db.doc(`service_cities/${ids.noBoundaryCity}`).set({ isServiceActive: false, countryId: ids.country, stateId: ids.state }),
    db.doc(`service_cities/${ids.wrongTypeCity}`).set({ isServiceActive: false, countryId: ids.country, stateId: ids.state, verifiedBoundaryId: ids.wrongTypeBoundary }),
    db.doc(`service_location_boundaries/${ids.wrongTypeBoundary}`).set(
      boundary(ids.wrongTypeCity, "area", polygonPoints(2, 2, 4, 4)),
    ),
    db.doc(`service_cities/${ids.missingStateCity}`).set({ isServiceActive: false, countryId: ids.country, verifiedBoundaryId: ids.missingStateBoundary }),
    db.doc(`service_location_boundaries/${ids.missingStateBoundary}`).set(boundary(ids.missingStateCity, "city", polygonPoints(0, 0, 10, 10))),
    db.doc(`service_cities/${ids.inactiveStateCity}`).set({ isServiceActive: false, countryId: ids.country, stateId: ids.inactiveState, verifiedBoundaryId: ids.inactiveStateBoundary }),
    db.doc(`service_location_boundaries/${ids.inactiveStateBoundary}`).set(boundary(ids.inactiveStateCity, "city", polygonPoints(0, 0, 10, 10))),
    db.doc(`service_cities/${ids.mismatchedStateCity}`).set({ isServiceActive: false, countryId: ids.country, stateId: ids.mismatchedState, verifiedBoundaryId: ids.mismatchedStateBoundary }),
    db.doc(`service_location_boundaries/${ids.mismatchedStateBoundary}`).set(boundary(ids.mismatchedStateCity, "city", polygonPoints(0, 0, 10, 10))),
    db.doc(`service_cities/${ids.inactiveParentCity}`).set({
      isServiceActive: false, verifiedBoundaryId: ids.cityBoundary,
    }),
    db.doc(`service_areas/${ids.inactiveParentArea}`).set({
      isServiceActive: false, cityId: ids.inactiveParentCity, verifiedBoundaryId: ids.inactiveParentAreaBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.inactiveParentAreaBoundary}`).set(
      boundary(ids.inactiveParentArea, "area", polygonPoints(2, 2, 4, 4)),
    ),
    db.doc(`service_areas/${ids.outsideArea}`).set({
      isServiceActive: false, countryId: ids.country, stateId: ids.state, cityId: ids.city, verifiedBoundaryId: ids.outsideAreaBoundary,
    }),
    db.doc(`service_location_boundaries/${ids.outsideAreaBoundary}`).set(
      boundary(ids.outsideArea, "area", polygonPoints(12, 12, 14, 14)),
    ),
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

  await t.test("invalid callable arguments are rejected", async () => {
    await expectCallableCode(invoke(ids.admin, "country", ids.city), "invalid-argument");
    await expectCallableCode(invoke(ids.admin, "city", "../bad-id"), "invalid-argument");
  });

  await t.test("malformed boundary document ID is rejected as failed-precondition", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.invalidBoundaryIdCity), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.invalidBoundaryIdCity}`).get()).get("isServiceActive"), false);
  });

  await t.test("verified boundary with a non-timestamp verifiedAt is rejected", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.invalidTimestampCity), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.invalidTimestampCity}`).get()).get("isServiceActive"), false);
  });

  await t.test("missing boundary reference is rejected", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.noBoundaryCity), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.noBoundaryCity}`).get()).get("isServiceActive"), false);
  });

  await t.test("boundary for a different location type is rejected", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.wrongTypeCity), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.wrongTypeCity}`).get()).get("isServiceActive"), false);
  });

  await t.test("Area activation is rejected when parent City is inactive", async () => {
    await expectCallableCode(invoke(ids.admin, "area", ids.inactiveParentArea), "failed-precondition");
    assert.equal((await db.doc(`service_areas/${ids.inactiveParentArea}`).get()).get("isServiceActive"), false);
  });

  await t.test("Area outside parent City boundary is rejected", async () => {
    await expectCallableCode(invoke(ids.admin, "area", ids.outsideArea), "failed-precondition");
    assert.equal((await db.doc(`service_areas/${ids.outsideArea}`).get()).get("isServiceActive"), false);
  });

  await t.test("invalid verified boundary is rejected and location stays inactive", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.invalidCity), "failed-precondition");
    const location = await db.doc(`service_cities/${ids.invalidCity}`).get();
    assert.equal(location.get("isServiceActive"), false);
  });

  await t.test("City activation rejects missing State reference", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.missingStateCity), "failed-precondition");
  });
  await t.test("City activation rejects inactive State", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.inactiveStateCity), "failed-precondition");
  });
  await t.test("City activation rejects State linked to another Country", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.mismatchedStateCity), "failed-precondition");
  });

  await t.test("active super_admin can activate a City with a valid verified boundary", async () => {
    const result = await invoke(ids.admin, "city", ids.city);
    assert.deepEqual(result, { ok: true, locationId: ids.city, locationType: "city" });
    assert.equal((await db.doc(`service_cities/${ids.city}`).get()).get("isServiceActive"), true);
    const audit = await db.collection("service_location_activation_audit")
      .where("actorUid", "==", ids.admin).where("locationId", "==", ids.city).get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].get("result"), "activated");
  });

  await t.test("District-aware City activation requires an active matching District and guards it", async () => {
    await expectCallableCode(invoke(ids.admin, "city", ids.districtCity), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.districtCity}`).get()).get("isServiceActive"), false);

    await db.doc(`service_districts/${ids.district}`).update({
      isServiceActive: true, stateId: ids.mismatchedState, countryId: ids.otherCountry,
    });
    await expectCallableCode(invoke(ids.admin, "city", ids.districtCity), "failed-precondition");

    await db.doc(`service_districts/${ids.district}`).update({
      isServiceActive: true, stateId: ids.state, countryId: ids.country,
    });
    const result = await invoke(ids.admin, "city", ids.districtCity);
    assert.deepEqual(result, { ok: true, locationId: ids.districtCity, locationType: "city" });
    assert.ok((await db.doc(`service_districts/${ids.district}`).get()).get("activationGuardAt"));

    await db.doc(`service_cities/${ids.districtCity}`).update({ isServiceActive: false });
    await db.doc(`service_districts/${ids.district}`).delete();
    await expectCallableCode(invoke(ids.admin, "city", ids.districtCity), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.districtCity}`).get()).get("isServiceActive"), false);
  });

  await t.test("active super_admin can activate an Area contained by its active City", async () => {
    const result = await invoke(ids.admin, "area", ids.area);
    assert.deepEqual(result, { ok: true, locationId: ids.area, locationType: "area" });
    assert.equal((await db.doc(`service_areas/${ids.area}`).get()).get("isServiceActive"), true);
  });
});
