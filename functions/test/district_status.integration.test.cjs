const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const {
  saveServiceLocationWithNameIndex,
  setServiceLocationStatus,
} = require("../lib/index");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("District callable integration tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}

const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = {
  admin: `district-admin-${suffix}`,
  ordinary: `district-user-${suffix}`,
  country: `district-country-${suffix}`,
  otherCountry: `district-country-other-${suffix}`,
  state: `district-state-${suffix}`,
  otherState: `district-state-other-${suffix}`,
  district: `district-target-${suffix}`,
  childCity: `district-child-city-${suffix}`,
  savedCity: "",
  childArea: `district-child-area-${suffix}`,
};

function request(uid, data) {
  return { auth: uid ? { uid, token: { uid } } : undefined, data, rawRequest: {}, acceptsStreaming: false };
}
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `Expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}
function indexId(name, stateId = ids.state, countryId = ids.country) {
  return serviceLocationNameIndexId(
    "service_districts",
    [countryId, stateId],
    name.trim().toLowerCase().replace(/\s+/g, " "),
  );
}
async function saveDistrict(uid, name, countryId = ids.country, stateId = ids.state, locationId) {
  const data = {
    locationType: "district",
    payload: { countryId, stateId, name },
  };
  if (locationId) data.locationId = locationId;
  return saveServiceLocationWithNameIndex.run(request(uid, data));
}
async function status(uid, locationId, isActive) {
  return setServiceLocationStatus.run(request(uid, {
    locationType: "district", locationId, isActive,
  }));
}

test("District save and status callable enforce trusted ancestry and child guards", async (t) => {
  const paths = [
    `admin_users/${ids.admin}`, `admin_users/${ids.ordinary}`,
    `service_countries/${ids.country}`, `service_countries/${ids.otherCountry}`,
    `service_states/${ids.state}`, `service_states/${ids.otherState}`,
    `service_districts/${ids.district}`, `service_cities/${ids.childCity}`,
    `service_areas/${ids.childArea}`,
  ];
  const indexIds = new Set();
  t.after(async () => {
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => undefined)));
    await Promise.all([...indexIds].map((id) =>
      db.doc(`service_location_name_indexes/${id}`).delete().catch(() => undefined)));
    const audits = await db.collection("service_location_status_audit")
      .where("actorUid", "==", ids.admin).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
  });

  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`admin_users/${ids.ordinary}`).set({ isActive: true, role: "customer" }),
    db.doc(`service_countries/${ids.country}`).set({ name: "Test Country", isActive: true }),
    db.doc(`service_countries/${ids.otherCountry}`).set({ name: "Other Country", isActive: true }),
    db.doc(`service_states/${ids.state}`).set({ name: "Test State", countryId: ids.country, isActive: true }),
    db.doc(`service_states/${ids.otherState}`).set({ name: "Other State", countryId: ids.otherCountry, isActive: true }),
  ]);

  await t.test("District save rejects unauthenticated and non-admin callers", async () => {
    await expectCode(saveDistrict(undefined, "District Unauthorized"), "unauthenticated");
    await expectCode(saveDistrict(ids.ordinary, "District Non Admin"), "permission-denied");
  });

  await t.test("District save rejects a State belonging to another Country", async () => {
    await expectCode(
      saveDistrict(ids.admin, "Mismatched Parent", ids.country, ids.otherState),
      "failed-precondition",
    );
    const index = db.doc(`service_location_name_indexes/${indexId("Mismatched Parent", ids.otherState, ids.country)}`);
    indexIds.add(index.id);
    assert.equal((await index.get()).exists, false);
  });

  await t.test("District save atomically creates document and canonical index", async () => {
    const name = `Test District ${suffix}`;
    indexIds.add(indexId(name));
    const result = await saveDistrict(ids.admin, name, ids.country, ids.state);
    ids.district = result.locationId;
    assert.equal(result.ok, true);
    assert.ok(ids.district);
    assert.equal(result.locationType, "district");
    const district = await db.doc(`service_districts/${ids.district}`).get();
    const index = await db.doc(`service_location_name_indexes/${indexId(name)}`).get();
    assert.equal(district.get("countryId"), ids.country);
    assert.equal(district.get("stateId"), ids.state);
    assert.equal(district.get("isServiceActive"), false);
    assert.equal(index.get("documentId"), ids.district);
    assert.equal(index.get("collectionPath"), "service_districts");
  });

  await t.test("duplicate District name under the same State is rejected", async () => {
    const name = `Test District ${suffix}`;
    await expectCode(saveDistrict(ids.admin, name, ids.country, ids.state), "already-exists");
    const matches = await db.collection("service_districts").where("name", "==", name).get();
    assert.equal(matches.size, 1);
  });

  await t.test("District cannot activate while Country or State is inactive", async () => {
    await db.doc(`service_countries/${ids.country}`).update({ isActive: false });
    await expectCode(status(ids.admin, ids.district, true), "failed-precondition");
    await db.doc(`service_countries/${ids.country}`).update({ isActive: true });
    await db.doc(`service_states/${ids.state}`).update({ isActive: false });
    await expectCode(status(ids.admin, ids.district, true), "failed-precondition");
    await db.doc(`service_states/${ids.state}`).update({ isActive: true });
    const result = await status(ids.admin, ids.district, true);
    assert.equal(result.isActive, true);
    assert.equal((await db.doc(`service_districts/${ids.district}`).get()).get("isServiceActive"), true);
    assert.ok((await db.doc(`service_countries/${ids.country}`).get()).get("activationGuardAt"));
    assert.ok((await db.doc(`service_states/${ids.state}`).get()).get("activationGuardAt"));
  });

  await t.test("District-aware City save preserves District ancestry and blocks implicit migration", async () => {
    const name = `District Scoped City ${suffix}`;
    const cityIndexId = serviceLocationNameIndexId(
      "service_cities",
      [ids.country, ids.state, ids.district],
      name.toLowerCase(),
    );
    indexIds.add(cityIndexId);
    const result = await saveServiceLocationWithNameIndex.run(request(ids.admin, {
      locationType: "city",
      payload: {
        countryId: ids.country,
        stateId: ids.state,
        districtId: ids.district,
        name,
      },
    }));
    ids.savedCity = result.locationId;
    paths.push(`service_cities/${ids.savedCity}`);
    assert.ok(ids.savedCity);
    assert.equal((await db.doc(`service_cities/${ids.savedCity}`).get()).get("districtId"), ids.district);
    assert.equal((await db.doc(`service_location_name_indexes/${cityIndexId}`).get()).get("documentId"), ids.savedCity);

    await expectCode(saveServiceLocationWithNameIndex.run(request(ids.admin, {
      locationType: "city",
      locationId: ids.savedCity,
      payload: { countryId: ids.country, stateId: ids.state, name },
    })), "failed-precondition");

    await expectCode(saveServiceLocationWithNameIndex.run(request(ids.admin, {
      locationType: "city",
      locationId: ids.savedCity,
      payload: {
        countryId: ids.country,
        stateId: ids.state,
        districtId: ids.otherState,
        name,
      },
    })), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.savedCity}`).get()).get("districtId"), ids.district);
  });

  await t.test("District deactivation is blocked by active City, Area and Locality descendants using canonical parent links", async () => {
    await db.doc(`service_cities/${ids.childCity}`).set({
      districtId: ids.district, countryId: ids.country, stateId: ids.state, isServiceActive: true,
    });
    await expectCode(status(ids.admin, ids.district, false), "failed-precondition");

    // An active Area may not carry districtId; District ancestry is derived
    // through its City. Keep the City inactive to exercise the descendant scan.
    await db.doc(`service_cities/${ids.childCity}`).update({ isServiceActive: false });
    await db.doc(`service_areas/${ids.childArea}`).set({
      countryId: ids.country, stateId: ids.state, cityId: ids.childCity, isServiceActive: true,
    });
    await expectCode(status(ids.admin, ids.district, false), "failed-precondition");

    await db.doc(`service_areas/${ids.childArea}`).update({ isServiceActive: false });
    await db.doc(`service_localities/district-child-locality-${suffix}`).set({
      countryId: ids.country, stateId: ids.state, cityId: ids.childCity,
      areaId: ids.childArea, isServiceActive: true,
    });
    paths.push(`service_localities/district-child-locality-${suffix}`);
    await expectCode(status(ids.admin, ids.district, false), "failed-precondition");

    await db.doc(`service_localities/district-child-locality-${suffix}`).update({ isServiceActive: false });
    const result = await status(ids.admin, ids.district, false);
    assert.equal(result.isActive, false);
    assert.equal((await db.doc(`service_districts/${ids.district}`).get()).get("isServiceActive"), false);
  });
});


test("concurrent State deactivation and District activation cannot leave an active District under an inactive State", async (t) => {
  const race = randomUUID().replace(/-/g, "").slice(0, 12);
  const raceIds = {
    admin: `district-race-admin-${race}`,
    country: `district-race-country-${race}`,
    state: `district-race-state-${race}`,
    district: `district-race-district-${race}`,
  };
  const paths = [
    `admin_users/${raceIds.admin}`,
    `service_countries/${raceIds.country}`,
    `service_states/${raceIds.state}`,
    `service_districts/${raceIds.district}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => undefined)));
    const audits = await db.collection("service_location_status_audit")
      .where("actorUid", "==", raceIds.admin).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
  });
  await Promise.all([
    db.doc(`admin_users/${raceIds.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`service_countries/${raceIds.country}`).set({ isActive: true }),
    db.doc(`service_states/${raceIds.state}`).set({ countryId: raceIds.country, isActive: true }),
    db.doc(`service_districts/${raceIds.district}`).set({
      countryId: raceIds.country, stateId: raceIds.state, isServiceActive: false,
    }),
  ]);
  const transition = (locationType, locationId, isActive) =>
    setServiceLocationStatus.run(request(raceIds.admin, { locationType, locationId, isActive }));
  const results = await Promise.allSettled([
    transition("state", raceIds.state, false),
    transition("district", raceIds.district, true),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
    "exactly one competing State/District transition should succeed",
  );
  const state = await db.doc(`service_states/${raceIds.state}`).get();
  const district = await db.doc(`service_districts/${raceIds.district}`).get();
  if (district.get("isServiceActive") === true) {
    assert.equal(state.get("isActive"), true, "active District must never have an inactive State");
  } else {
    assert.equal(state.get("isActive"), false, "if State deactivation wins, District must remain inactive");
  }
});
