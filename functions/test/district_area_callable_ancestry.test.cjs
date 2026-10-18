const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { saveServiceLocationWithNameIndex } = require("../lib/index");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");

const db = getFirestore();

test("Area save rejects a City whose District link points to a missing District", async () => {
  const suffix = randomUUID();
  const uid = `district-ancestry-admin-${suffix}`;
  const countryId = `district-country-${suffix}`;
  const stateId = `district-state-${suffix}`;
  const cityId = `district-city-${suffix}`;
  const missingDistrictId = `district-missing-${suffix}`;
  const areaName = `District-Guard-Area-${suffix}`;
  const indexId = serviceLocationNameIndexId(
    "service_areas",
    [countryId, stateId, cityId],
    areaName.toLowerCase(),
  );
  const refs = [
    db.doc(`admin_users/${uid}`),
    db.doc(`service_countries/${countryId}`),
    db.doc(`service_states/${stateId}`),
    db.doc(`service_cities/${cityId}`),
    db.doc(`service_areas/${`unused-${suffix}`}`),
    db.doc(`service_location_name_indexes/${indexId}`),
  ];

  try {
    await refs[0].set({ role: "admin", isActive: true });
    await refs[1].set({ name: "Test Country", code: "TC", isActive: true });
    await refs[2].set({ name: "Test State", countryId, isActive: true });
    await refs[3].set({
      name: "Test City", countryId, stateId, districtId: missingDistrictId,
      isServiceActive: false,
    });

    await assert.rejects(
      () => saveServiceLocationWithNameIndex.run({
        data: {
          locationType: "area",
          payload: { countryId, stateId, cityId, name: areaName },
        },
        auth: { uid, token: { uid, role: "admin" } },
        rawRequest: {},
        acceptsStreaming: false,
      }),
      (error) => error && error.code === "failed-precondition",
    );

    const areaMatches = await db.collection("service_areas").where("name", "==", areaName).get();
    assert.equal(areaMatches.empty, true);
    assert.equal((await refs[5].get()).exists, false);
  } finally {
    await Promise.all(refs.map(ref => ref.delete().catch(() => undefined)));
    await db.collection("service_areas").where("name", "==", areaName).get()
      .then(snap => Promise.all(snap.docs.map(doc => doc.ref.delete())));
  }
});
