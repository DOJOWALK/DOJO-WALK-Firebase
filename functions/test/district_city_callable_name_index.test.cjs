const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { saveServiceLocationWithNameIndex } = require("../lib/index");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");

const db = getFirestore();

function request(uid, data) {
  return {
    data,
    auth: uid ? { uid, token: { uid, role: "admin" } } : undefined,
    rawRequest: {},
    acceptsStreaming: false,
  };
}

function normalized(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function indexRef(collection, parents, name) {
  const id = serviceLocationNameIndexId(collection, parents, normalized(name));
  return { id, ref: db.doc(`service_location_name_indexes/${id}`) };
}

async function save(uid, locationType, payload, locationId) {
  const data = { locationType, payload };
  if (locationId) data.locationId = locationId;
  return saveServiceLocationWithNameIndex.run(request(uid, data));
}

async function setup(t) {
  const suffix = randomUUID();
  const uid = `district-city-index-${suffix}`;
  const countryId = `dc-country-${suffix}`;
  const stateId = `dc-state-${suffix}`;
  const districtAId = `dc-district-a-${suffix}`;
  const districtBId = `dc-district-b-${suffix}`;
  const cityIds = new Set();
  const indexIds = new Set();
  const docRefs = [
    db.doc(`admin_users/${uid}`),
    db.doc(`service_countries/${countryId}`),
    db.doc(`service_states/${stateId}`),
    db.doc(`service_districts/${districtAId}`),
    db.doc(`service_districts/${districtBId}`),
  ];
  await docRefs[0].set({ role: "admin", isActive: true });
  await save(uid, "country", { name: `Index Country ${suffix}`, code: `C${suffix.slice(0, 6)}` }, countryId);
  await save(uid, "state", { countryId, name: `Index State ${suffix}` }, stateId);
  await save(uid, "district", { countryId, stateId, name: `Index District A ${suffix}` }, districtAId);
  await save(uid, "district", { countryId, stateId, name: `Index District B ${suffix}` }, districtBId);

  t.after(async () => {
    await Promise.all([
      ...[...docRefs, ...[...cityIds].map(id => db.doc(`service_cities/${id}`))]
        .map(ref => ref.delete().catch(() => undefined)),
      ...[...indexIds].map(id => db.doc(`service_location_name_indexes/${id}`).delete().catch(() => undefined)),
    ]);
  });

  function trackIndex(parents, name) {
    const result = indexRef("service_cities", parents, name);
    indexIds.add(result.id);
    return result;
  }
  async function saveCity(districtId, name, cityId) {
    const result = await save(uid, "city", {
      countryId, stateId, ...(districtId ? { districtId } : {}), name,
    }, cityId);
    cityIds.add(result.locationId);
    return result;
  }
  return { countryId, stateId, districtAId, districtBId, trackIndex, saveCity };
}

test("District-linked City name is unique within its District and allowed in another District", async (t) => {
  const ctx = await setup(t);
  const name = `Shared District City ${randomUUID()}`;
  const cityA = await ctx.saveCity(ctx.districtAId, name);
  const indexA = ctx.trackIndex([ctx.countryId, ctx.stateId, ctx.districtAId], name);
  const storedA = await indexA.ref.get();

  assert.equal(storedA.exists, true);
  assert.equal(storedA.get("documentId"), cityA.locationId);
  assert.deepEqual(storedA.get("parentIds"), [ctx.countryId, ctx.stateId, ctx.districtAId]);

  await assert.rejects(
    () => ctx.saveCity(ctx.districtAId, name),
    error => error && error.code === "already-exists",
  );

  const cityB = await ctx.saveCity(ctx.districtBId, name);
  const indexB = ctx.trackIndex([ctx.countryId, ctx.stateId, ctx.districtBId], name);
  const storedB = await indexB.ref.get();

  assert.notEqual(cityA.locationId, cityB.locationId);
  assert.equal(storedB.get("documentId"), cityB.locationId);
  assert.deepEqual(storedB.get("parentIds"), [ctx.countryId, ctx.stateId, ctx.districtBId]);
});

test("legacy City without District keeps its two-parent index and blocks same-State duplicate", async (t) => {
  const ctx = await setup(t);
  const name = `Shared Legacy City ${randomUUID()}`;
  const city = await ctx.saveCity(undefined, name);
  const index = ctx.trackIndex([ctx.countryId, ctx.stateId], name);
  const stored = await index.ref.get();

  assert.equal(stored.exists, true);
  assert.equal(stored.get("documentId"), city.locationId);
  assert.deepEqual(stored.get("parentIds"), [ctx.countryId, ctx.stateId]);

  await assert.rejects(
    () => ctx.saveCity(undefined, name),
    error => error && error.code === "already-exists",
  );
});

test("renaming a District-linked City atomically replaces its District-scoped index", async (t) => {
  const ctx = await setup(t);
  const oldName = `Old District City ${randomUUID()}`;
  const newName = `New District City ${randomUUID()}`;
  const city = await ctx.saveCity(ctx.districtAId, oldName);
  const oldIndex = ctx.trackIndex([ctx.countryId, ctx.stateId, ctx.districtAId], oldName);
  const newIndex = ctx.trackIndex([ctx.countryId, ctx.stateId, ctx.districtAId], newName);

  const renamed = await ctx.saveCity(ctx.districtAId, newName, city.locationId);
  const [oldStored, newStored, cityStored] = await Promise.all([
    oldIndex.ref.get(), newIndex.ref.get(), db.doc(`service_cities/${city.locationId}`).get(),
  ]);

  assert.equal(renamed.locationId, city.locationId);
  assert.equal(oldStored.exists, false);
  assert.equal(newStored.exists, true);
  assert.equal(newStored.get("documentId"), city.locationId);
  assert.equal(newStored.get("name"), normalized(newName));
  assert.equal(cityStored.get("name"), newName);
  assert.equal(cityStored.get("districtId"), ctx.districtAId);
});
