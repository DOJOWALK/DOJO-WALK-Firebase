const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// This suite must never run against a real Firestore project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Callable integration tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}

const { GeoPoint, getFirestore } = require("firebase-admin/firestore");
const { activateServiceLocation, setServiceLocationStatus, approveInitialServiceAreaLaunch, revokeInitialServiceAreaApproval } = require("../lib/index");

const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = {
  ordinary: `it-ordinary-${suffix}`,
  inactive: `it-inactive-${suffix}`,
  admin: `it-admin-${suffix}`,
  founder: `it-founder-${suffix}`,
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
    "company_authorities/founder_ceo",
    "company_launch_control/initial_service_area",
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
    const approvals = await db.collection("service_area_launch_approvals").where("areaId", "==", ids.area).get();
    await Promise.all(approvals.docs.map((doc) => doc.ref.delete()));
    const launchAudits = await db.collection("company_launch_approval_audit").where("areaId", "==", ids.area).get();
    await Promise.all(launchAudits.docs.map((doc) => doc.ref.delete()));
    const audits = await db.collection("service_location_activation_audit")
      .where("actorUid", "==", ids.admin).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
  });

  await Promise.all([
    db.doc(`admin_users/${ids.inactive}`).set({ isActive: false, role: "super_admin" }),
    db.doc(`admin_users/${ids.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc("company_authorities/founder_ceo").set({ uid: ids.founder, isActive: true }),
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
    await expectCallableCode(setServiceLocationStatus.run({
      auth: { uid: ids.admin, token: { uid: ids.admin } },
      data: { locationType: "city", locationId: ids.districtCity, isActive: true },
    }), "failed-precondition");
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

  await t.test("first Area requires exact Founder/CEO GO, revocation blocks it, and activation consumes GO", async () => {
    await expectCallableCode(invoke(ids.admin, "area", ids.area), "failed-precondition");
    await expectCallableCode(approveInitialServiceAreaLaunch.run({
      auth: { uid: ids.admin, token: { uid: ids.admin } },
      data: { areaId: ids.area, reason: "Launch approved after readiness review." },
    }), "permission-denied");

    const firstApproval = await approveInitialServiceAreaLaunch.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { areaId: ids.area, reason: "Founder GO after readiness review." },
    });
    assert.equal(firstApproval.status, "approved");
    assert.equal(firstApproval.areaId, ids.area);

    const revoked = await revokeInitialServiceAreaApproval.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { reason: "Readiness evidence needs one more review." },
    });
    assert.equal(revoked.status, "revoked");
    await expectCallableCode(invoke(ids.admin, "area", ids.area), "failed-precondition");

    const secondApproval = await approveInitialServiceAreaLaunch.run({
      auth: { uid: ids.founder, token: { uid: ids.founder } },
      data: { areaId: ids.area, reason: "Founder GO after final readiness review." },
    });
    const result = await invoke(ids.admin, "area", ids.area);
    assert.deepEqual(result, { ok: true, locationId: ids.area, locationType: "area" });
    assert.equal((await db.doc(`service_areas/${ids.area}`).get()).get("isServiceActive"), true);
    const control = await db.doc("company_launch_control/initial_service_area").get();
    assert.equal(control.get("status"), "consumed");
    assert.equal(control.get("areaId"), ids.area);
    const approval = await db.doc(`service_area_launch_approvals/${secondApproval.approvalId}`).get();
    assert.equal(approval.get("status"), "consumed");
    const audit = await db.collection("company_launch_approval_audit")
      .where("areaId", "==", ids.area).get();
    assert.equal(audit.size, 4);
  });
});


test("concurrent District deactivation and City activation cannot both succeed", async (t) => {
  const race = Object.fromEntries(
    ["admin", "country", "state", "district", "city", "boundary"]
      .map((key) => [key, `it-district-race-${key}-${randomUUID().replace(/-/g, "").slice(0, 12)}`]),
  );
  const paths = [
    `admin_users/${race.admin}`, `service_countries/${race.country}`,
    `service_states/${race.state}`, `service_districts/${race.district}`,
    `service_cities/${race.city}`, `service_location_boundaries/${race.boundary}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    for (const collection of ["service_location_activation_audit", "service_location_status_audit"]) {
      const audits = await db.collection(collection).where("actorUid", "==", race.admin).get();
      await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
    }
  });
  await Promise.all([
    db.doc(`admin_users/${race.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`service_countries/${race.country}`).set({ isActive: true }),
    db.doc(`service_states/${race.state}`).set({ countryId: race.country, isActive: true }),
    db.doc(`service_districts/${race.district}`).set({
      countryId: race.country, stateId: race.state, isServiceActive: true,
    }),
    db.doc(`service_cities/${race.city}`).set({
      countryId: race.country, stateId: race.state, districtId: race.district,
      isServiceActive: false, verifiedBoundaryId: race.boundary,
    }),
    db.doc(`service_location_boundaries/${race.boundary}`).set(
      boundary(race.city, "city", polygonPoints(0, 0, 10, 10)),
    ),
  ]);

  const outcomes = await Promise.allSettled([
    activateServiceLocation.run({
      auth: { uid: race.admin, token: { uid: race.admin } },
      data: { locationType: "city", locationId: race.city },
    }),
    setServiceLocationStatus.run({
      auth: { uid: race.admin, token: { uid: race.admin } },
      data: { locationType: "district", locationId: race.district, isActive: false },
    }),
  ]);
  const city = await db.doc(`service_cities/${race.city}`).get();
  const district = await db.doc(`service_districts/${race.district}`).get();
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
    "exactly one competing transition should succeed",
  );
  if (city.get("isServiceActive") === true) {
    assert.equal(district.get("isServiceActive"), true, "an active City must retain its active District");
  } else {
    assert.equal(district.get("isServiceActive"), false, "if District deactivation wins, City must remain inactive");
  }
});
