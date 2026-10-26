const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Boundary review integration tests require Firestore Emulator; refusing to run without it.");
}

const { GeoPoint, getFirestore } = require("firebase-admin/firestore");
const { reviewServiceLocationBoundary } = require("../lib/index");
const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = {
  admin: `review-admin-${suffix}`,
  support: `review-support-${suffix}`,
  city: `review-city-${suffix}`,
  reviewCity: `review-owner-city-${suffix}`,
  cityBoundary: `review-city-boundary-${suffix}`,
  parentCityBoundary: `review-parent-city-boundary-${suffix}`,
  area: `review-area-${suffix}`,
  areaBoundary: `review-area-boundary-${suffix}`,
  outsideArea: `review-outside-area-${suffix}`,
  outsideAreaBoundary: `review-outside-area-boundary-${suffix}`,
};

const points = (south, west, north, east) => [
  new GeoPoint(south, west),
  new GeoPoint(south, east),
  new GeoPoint(north, east),
  new GeoPoint(north, west),
  new GeoPoint(south, west),
];

function pendingBoundary(locationId, locationType, polygonPoints) {
  return {
    locationId,
    locationType,
    points: polygonPoints,
    sourceType: "governmentGis",
    sourceName: "Synthetic integration fixture",
    sourceReference: "TEST-ONLY",
    verificationStatus: "pending",
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function invoke(uid, boundaryId, decision = "verified") {
  return reviewServiceLocationBoundary.run({
    ...(uid ? { auth: { uid, token: { uid } } } : {}),
    data: { boundaryId, decision, notes: "Synthetic integration test review" },
  });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `Expected ${code}; got ${error.code}: ${error.message}`);
    return true;
  });
}

test("trusted boundary review enforces auth, role, geometry and Area containment", async (t) => {
  const paths = [
    `admin_users/${ids.admin}`,
    `admin_users/${ids.support}`,
    `service_cities/${ids.city}`,
    `service_cities/${ids.reviewCity}`,
    `service_location_boundaries/${ids.cityBoundary}`,
    `service_location_boundaries/${ids.parentCityBoundary}`,
    `service_areas/${ids.area}`,
    `service_location_boundaries/${ids.areaBoundary}`,
    `service_areas/${ids.outsideArea}`,
    `service_location_boundaries/${ids.outsideAreaBoundary}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    const audits = await db.collection("service_location_boundary_review_audit")
      .where("boundaryId", "in", [ids.cityBoundary, ids.areaBoundary, ids.outsideAreaBoundary]).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
  });

  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ role: "central_admin", isActive: true }),
    db.doc(`admin_users/${ids.support}`).set({ role: "support", isActive: true }),
    db.doc(`service_cities/${ids.city}`).set({
      countryId: "test-country", stateId: "test-state", isServiceActive: true,
      verifiedBoundaryId: ids.parentCityBoundary,
    }),
    db.doc(`service_cities/${ids.reviewCity}`).set({
      countryId: "test-country", stateId: "test-state", isServiceActive: false,
    }),
    db.doc(`service_location_boundaries/${ids.parentCityBoundary}`).set({
      ...pendingBoundary(ids.city, "city", points(28.50, 77.30, 28.60, 77.40)),
      verificationStatus: "verified",
      verifiedBy: ids.admin,
      verifiedAt: new Date(),
    }),
    db.doc(`service_location_boundaries/${ids.cityBoundary}`).set(
      pendingBoundary(ids.reviewCity, "city", points(28.50, 77.30, 28.60, 77.40)),
    ),
    db.doc(`service_areas/${ids.area}`).set({ cityId: ids.city }),
    db.doc(`service_location_boundaries/${ids.areaBoundary}`).set(
      pendingBoundary(ids.area, "area", points(28.52, 77.32, 28.54, 77.34)),
    ),
    db.doc(`service_areas/${ids.outsideArea}`).set({ cityId: ids.city }),
    db.doc(`service_location_boundaries/${ids.outsideAreaBoundary}`).set(
      pendingBoundary(ids.outsideArea, "area", points(28.55, 77.35, 28.62, 77.38)),
    ),
  ]);

  await expectCode(invoke(undefined, ids.areaBoundary), "unauthenticated");
  await expectCode(invoke(ids.support, ids.areaBoundary), "permission-denied");

  const cityReview = await invoke(ids.admin, ids.cityBoundary);
  assert.equal(cityReview.decision, "verified");
  const verifiedCity = await db.doc(`service_location_boundaries/${ids.cityBoundary}`).get();
  assert.equal(verifiedCity.get("verifiedBy"), ids.admin);
  assert.equal(verifiedCity.get("verificationStatus"), "verified");
  const reviewCity = await db.doc(`service_cities/${ids.reviewCity}`).get();
  assert.equal(reviewCity.get("verifiedBoundaryId"), ids.cityBoundary);

  const areaReview = await invoke(ids.admin, ids.areaBoundary);
  assert.equal(areaReview.decision, "verified");

  await expectCode(invoke(ids.admin, ids.outsideAreaBoundary), "failed-precondition");
  const rejectedArea = await db.doc(`service_location_boundaries/${ids.outsideAreaBoundary}`).get();
  assert.equal(rejectedArea.get("verificationStatus"), "pending");
});