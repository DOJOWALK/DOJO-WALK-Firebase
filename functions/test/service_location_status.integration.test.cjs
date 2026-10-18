const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Status callable tests require FIRESTORE_EMULATOR_HOST; refusing to run without the Firestore Emulator.");
}
const { getFirestore } = require("firebase-admin/firestore");
const { setServiceLocationStatus } = require("../lib/index");
const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = Object.fromEntries(["admin","ordinary","inactiveAdmin","country","state","city","area","locality","inactiveArea","pendingLocality"]
  .map((key) => [key, `status-${key}-${suffix}`]));

async function invoke(uid, locationType, locationId, isActive) {
  return setServiceLocationStatus.run({
    auth: uid ? { uid, token: { uid } } : undefined,
    data: { locationType, locationId, isActive },
  });
}
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `Expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

test("status callable enforces admin access and active-child guards", async (t) => {
  const paths = [
    `admin_users/${ids.admin}`, `admin_users/${ids.ordinary}`, `admin_users/${ids.inactiveAdmin}`,
    `service_countries/${ids.country}`, `service_states/${ids.state}`,
    `service_cities/${ids.city}`, `service_areas/${ids.area}`,
    `service_areas/${ids.inactiveArea}`, `service_localities/${ids.locality}`, `service_localities/${ids.pendingLocality}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
    const audits = await db.collection("service_location_status_audit")
      .where("actorUid", "==", ids.admin).get();
    await Promise.all(audits.docs.map((doc) => doc.ref.delete()));
  });
  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`admin_users/${ids.ordinary}`).set({ isActive: true, role: "customer" }),
    db.doc(`admin_users/${ids.inactiveAdmin}`).set({ isActive: false, role: "super_admin" }),
    db.doc(`service_countries/${ids.country}`).set({ isActive: true }),
    db.doc(`service_states/${ids.state}`).set({ countryId: ids.country, isActive: true }),
    db.doc(`service_cities/${ids.city}`).set({ countryId: ids.country, stateId: ids.state, isServiceActive: true }),
    db.doc(`service_areas/${ids.area}`).set({ countryId: ids.country, stateId: ids.state, cityId: ids.city, isServiceActive: true }),
    db.doc(`service_areas/${ids.inactiveArea}`).set({ countryId: ids.country, stateId: ids.state, cityId: ids.city, isServiceActive: false }),
    db.doc(`service_localities/${ids.locality}`).set({ countryId: ids.country, stateId: ids.state, cityId: ids.city, areaId: ids.area, isServiceActive: true }),
    db.doc(`service_localities/${ids.pendingLocality}`).set({ countryId: ids.country, stateId: ids.state, cityId: ids.city, areaId: ids.area, isServiceActive: false }),
  ]);

  await t.test("rejects unauthenticated and non-admin callers", async () => {
    await expectCode(invoke(undefined, "area", ids.area, false), "unauthenticated");
    await expectCode(invoke(ids.ordinary, "area", ids.area, false), "permission-denied");
    await expectCode(invoke(ids.inactiveAdmin, "area", ids.area, false), "permission-denied");
  });
  await t.test("Country cannot be deactivated while an active State exists", async () => {
    await expectCode(invoke(ids.admin, "country", ids.country, false), "failed-precondition");
    assert.equal((await db.doc(`service_countries/${ids.country}`).get()).get("isActive"), true);
  });
  await t.test("State cannot be deactivated while an active City exists", async () => {
    await expectCode(invoke(ids.admin, "state", ids.state, false), "failed-precondition");
    assert.equal((await db.doc(`service_states/${ids.state}`).get()).get("isActive"), true);
  });
  await t.test("City cannot be deactivated while an active Area exists", async () => {
    await expectCode(invoke(ids.admin, "city", ids.city, false), "failed-precondition");
    assert.equal((await db.doc(`service_cities/${ids.city}`).get()).get("isServiceActive"), true);
  });
  await t.test("Area cannot be deactivated while an active Locality exists", async () => {
    await expectCode(invoke(ids.admin, "area", ids.area, false), "failed-precondition");
    assert.equal((await db.doc(`service_areas/${ids.area}`).get()).get("isServiceActive"), true);
  });
  await t.test("Area can be deactivated when it has no active Locality", async () => {
    const result = await invoke(ids.admin, "area", ids.inactiveArea, false);
    assert.deepEqual(result, { ok: true, locationId: ids.inactiveArea, locationType: "area", isActive: false });
  });
  await t.test("Country and State activation require active parent chain", async () => {
    await db.doc(`service_states/${ids.state}`).update({ isActive: false });
    await db.doc(`service_countries/${ids.country}`).update({ isActive: false });
    await expectCode(invoke(ids.admin, "state", ids.state, true), "failed-precondition");
    await db.doc(`service_countries/${ids.country}`).update({ isActive: true });
    const result = await invoke(ids.admin, "state", ids.state, true);
    assert.equal(result.isActive, true);
    assert.equal((await db.doc(`service_states/${ids.state}`).get()).get("isActive"), true);
  });

  await t.test("Locality activation validates and guard-locks the complete active ancestry", async () => {
    const result = await invoke(ids.admin, "locality", ids.pendingLocality, true);
    assert.equal(result.isActive, true);
    assert.equal((await db.doc(`service_localities/${ids.pendingLocality}`).get()).get("isServiceActive"), true);
    await db.doc(`service_localities/${ids.pendingLocality}`).update({ isServiceActive: false });
    await db.doc(`service_areas/${ids.inactiveArea}`).update({ isServiceActive: false });
    await db.doc(`service_localities/${ids.pendingLocality}`).update({ areaId: ids.inactiveArea });
    await expectCode(invoke(ids.admin, "locality", ids.pendingLocality, true), "failed-precondition");
  });
});


test("concurrent Country deactivation and State activation cannot both succeed", async (t) => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const adminId = `status-race-admin-${suffix}`;
  const countryId = `status-race-country-${suffix}`;
  const stateId = `status-race-state-${suffix}`;
  t.after(async () => {
    await Promise.all([
      db.doc(`admin_users/${adminId}`).delete().catch(() => undefined),
      db.doc(`service_countries/${countryId}`).delete().catch(() => undefined),
      db.doc(`service_states/${stateId}`).delete().catch(() => undefined),
    ]);
  });
  await Promise.all([
    db.doc(`admin_users/${adminId}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`service_countries/${countryId}`).set({ isActive: true }),
    db.doc(`service_states/${stateId}`).set({ countryId, isActive: false }),
  ]);
  const results = await Promise.allSettled([
    invoke(adminId, "country", countryId, false),
    invoke(adminId, "state", stateId, true),
  ]);
  const country = await db.doc(`service_countries/${countryId}`).get();
  const state = await db.doc(`service_states/${stateId}`).get();
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
    "exactly one competing transition should succeed",
  );
  if (state.get("isActive") === true) {
    assert.equal(country.get("isActive"), true, "active State must never have an inactive Country");
  } else {
    assert.equal(country.get("isActive"), false, "if Country deactivation wins, State must remain inactive");
  }
});


test("concurrent Area deactivation and Locality activation cannot both succeed", async (t) => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const ids = {
    admin: `status-locality-race-admin-${suffix}`,
    country: `status-locality-race-country-${suffix}`,
    state: `status-locality-race-state-${suffix}`,
    city: `status-locality-race-city-${suffix}`,
    area: `status-locality-race-area-${suffix}`,
    locality: `status-locality-race-locality-${suffix}`,
  };
  const paths = [
    `admin_users/${ids.admin}`, `service_countries/${ids.country}`,
    `service_states/${ids.state}`, `service_cities/${ids.city}`,
    `service_areas/${ids.area}`, `service_localities/${ids.locality}`,
  ];
  t.after(async () => {
    await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => undefined)));
  });
  await Promise.all([
    db.doc(`admin_users/${ids.admin}`).set({ isActive: true, role: "super_admin" }),
    db.doc(`service_countries/${ids.country}`).set({ isActive: true }),
    db.doc(`service_states/${ids.state}`).set({ countryId: ids.country, isActive: true }),
    db.doc(`service_cities/${ids.city}`).set({
      countryId: ids.country, stateId: ids.state, isServiceActive: true,
    }),
    db.doc(`service_areas/${ids.area}`).set({
      countryId: ids.country, stateId: ids.state, cityId: ids.city, isServiceActive: true,
    }),
    db.doc(`service_localities/${ids.locality}`).set({
      countryId: ids.country, stateId: ids.state, cityId: ids.city,
      areaId: ids.area, isServiceActive: false,
    }),
  ]);
  const results = await Promise.allSettled([
    invoke(ids.admin, "area", ids.area, false),
    invoke(ids.admin, "locality", ids.locality, true),
  ]);
  const area = await db.doc(`service_areas/${ids.area}`).get();
  const locality = await db.doc(`service_localities/${ids.locality}`).get();
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
    "exactly one competing transition should succeed",
  );
  if (locality.get("isServiceActive") === true) {
    assert.equal(area.get("isServiceActive"), true, "active Locality must never have an inactive Area");
  } else {
    assert.equal(area.get("isServiceActive"), false, "if Area deactivation wins, Locality must remain inactive");
  }
});
