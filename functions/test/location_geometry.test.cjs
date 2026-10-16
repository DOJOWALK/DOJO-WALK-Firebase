const test = require("node:test");
const assert = require("node:assert/strict");
const { polygonFromBoundary, assertAreaCoveredByCity } = require("../lib/location_geometry");

const boundary = (locationId, locationType, points) => ({
  locationId, locationType, verificationStatus: "verified",
  sourceName: "test source", sourceReference: "test-ref",
  verifiedBy: "test-admin", verifiedAt: new Date(), points,
});
const city = boundary("city-1", "city", [
  { lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 },
]);
const inside = boundary("area-1", "area", [
  { lat: 2, lng: 2 }, { lat: 2, lng: 4 }, { lat: 4, lng: 4 }, { lat: 4, lng: 2 },
]);
const outside = boundary("area-2", "area", [
  { lat: 8, lng: 8 }, { lat: 8, lng: 12 }, { lat: 12, lng: 12 }, { lat: 12, lng: 8 },
]);

test("valid polygon boundary is accepted", () => {
  assert.ok(polygonFromBoundary(city));
});
test("area fully covered by city is accepted", () => {
  assert.doesNotThrow(() => assertAreaCoveredByCity(inside, city));
});
test("area crossing city boundary is rejected", () => {
  assert.throws(() => assertAreaCoveredByCity(outside, city), /AREA_NOT_FULLY_WITHIN_PARENT_CITY/);
});
test("malformed coordinates are rejected", () => {
  assert.throws(() => polygonFromBoundary(boundary("bad", "area", [
    { lat: 91, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 },
  ])), /BOUNDARY_COORDINATE_INVALID/);
});
test("fewer than three distinct points are rejected", () => {
  assert.throws(() => polygonFromBoundary(boundary("bad", "area", [
    { lat: 0, lng: 0 }, { lat: 0, lng: 0 }, { lat: 0, lng: 0 },
  ])), /BOUNDARY_NEEDS_THREE_DISTINCT_POINTS/);
});

test("Firestore GeoPoint-shaped latitude/longitude boundary is accepted", () => {
  const firestoreCity = boundary("city-firestore", "city", [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 10 },
    { latitude: 10, longitude: 10 },
    { latitude: 10, longitude: 0 },
  ]);
  assert.doesNotThrow(() => polygonFromBoundary(firestoreCity));
});

test("Firestore GeoPoint-shaped Area is checked against City containment", () => {
  const firestoreCity = boundary("city-firestore", "city", [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 10 },
    { latitude: 10, longitude: 10 },
    { latitude: 10, longitude: 0 },
  ]);
  const firestoreArea = boundary("area-firestore", "area", [
    { latitude: 2, longitude: 2 },
    { latitude: 2, longitude: 4 },
    { latitude: 4, longitude: 4 },
    { latitude: 4, longitude: 2 },
  ]);
  assert.doesNotThrow(() => assertAreaCoveredByCity(firestoreArea, firestoreCity));
});
