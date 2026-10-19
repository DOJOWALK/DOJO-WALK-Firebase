const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { saveServiceLocationWithNameIndex } = require("../lib/index");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");
const { districtAwareNameIndexId } = require("../lib/district_name_index_contract");

const db = getFirestore();

async function fixture({ district = true, createDistrictDocument = true, districtStateMismatch = false } = {}) {
  const s = randomUUID();
  const f = {
    uid: `district-matrix-admin-${s}`,
    countryId: `matrix-country-${s}`,
    stateId: `matrix-state-${s}`,
    otherStateId: `matrix-other-state-${s}`,
    districtId: `matrix-district-${s}`,
    cityId: `matrix-city-${s}`,
    areaId: `matrix-area-${s}`,
    localityName: `Matrix-Locality-${s}`,
    areaName: `Matrix-Area-${s}`,
  };
  const refs = [
    db.doc(`admin_users/${f.uid}`),
    db.doc(`service_countries/${f.countryId}`),
    db.doc(`service_states/${f.stateId}`),
    db.doc(`service_states/${f.otherStateId}`),
    db.doc(`service_districts/${f.districtId}`),
    db.doc(`service_cities/${f.cityId}`),
    db.doc(`service_areas/${f.areaId}`),
  ];
  await refs[0].set({ role: "admin", isActive: true });
  await refs[1].set({ name: "Matrix Country", code: "MC", isActive: true });
  await refs[2].set({ name: "Matrix State", countryId: f.countryId, isActive: true });
  await refs[3].set({ name: "Other State", countryId: f.countryId, isActive: true });
  if (district && createDistrictDocument) await refs[4].set({
    name: "Matrix District", countryId: f.countryId,
    stateId: districtStateMismatch ? f.otherStateId : f.stateId, isActive: true,
  });
  await refs[5].set({
    name: "Matrix City", countryId: f.countryId, stateId: f.stateId,
    ...(district ? { districtId: f.districtId } : {}),
    isServiceActive: false,
  });
  await refs[6].set({
    name: f.areaName, countryId: f.countryId, stateId: f.stateId,
    cityId: f.cityId, isServiceActive: false,
  });
  return { ...f, refs };
}

async function cleanup(f) {
  const queries = [
    db.collection("service_areas").where("name", "==", f.areaName),
    db.collection("service_localities").where("name", "==", f.localityName),
  ];
  const snapshots = await Promise.all(queries.map(q => q.get()));
  const docs = snapshots.flatMap(s => s.docs.map(d => d.ref));
  await Promise.all([...f.refs, ...docs].map(ref => ref.delete().catch(() => undefined)));
  const indexIds = [
    serviceLocationNameIndexId("service_areas", [f.countryId, f.stateId, f.cityId], f.areaName.toLowerCase()),
    serviceLocationNameIndexId("service_areas", [f.countryId, f.stateId, f.districtId, f.cityId], f.areaName.toLowerCase()),
    serviceLocationNameIndexId("service_localities", [f.countryId, f.stateId, f.cityId, f.areaId], f.localityName.toLowerCase()),
    ...(f.district ? [serviceLocationNameIndexId("service_localities", [f.countryId, f.stateId, f.districtId, f.cityId, f.areaId], f.localityName.toLowerCase())] : []),
  ];
  await Promise.all(indexIds.map(id => db.doc(`service_location_name_indexes/${id}`).delete().catch(() => undefined)));
}

function req(uid, locationType, payload) {
  return {
    data: { locationType, payload },
    auth: { uid, token: { uid, role: "admin" } },
    rawRequest: {},
    acceptsStreaming: false,
  };
}

test("Area rejects District document belonging to another State without writes", async () => {
  const f = await fixture({ districtStateMismatch: true });
  const attemptedAreaName = `Rejected-Area-${randomUUID()}`;
  try {
    await assert.rejects(
      () => saveServiceLocationWithNameIndex.run(req(f.uid, "area", {
        countryId: f.countryId, stateId: f.stateId, cityId: f.cityId, name: attemptedAreaName,
      })),
      e => e && e.code === "failed-precondition",
    );
    assert.equal((await db.collection("service_areas").where("name", "==", attemptedAreaName).get()).empty, true);
    const idx = serviceLocationNameIndexId("service_areas", [f.countryId, f.stateId, f.cityId], attemptedAreaName.toLowerCase());
    assert.equal((await db.doc(`service_location_name_indexes/${idx}`).get()).exists, false);
  } finally { await cleanup(f); }
});

test("Locality rejects City with missing District record without writes", async () => {
  const f = await fixture({ district: true, createDistrictDocument: false });
  try {
    await assert.rejects(
      () => saveServiceLocationWithNameIndex.run(req(f.uid, "locality", {
        countryId: f.countryId, stateId: f.stateId, cityId: f.cityId,
        areaId: f.areaId, name: f.localityName,
      })),
      e => e && e.code === "failed-precondition",
    );
    assert.equal((await db.collection("service_localities").where("name", "==", f.localityName).get()).empty, true);
    const idx = serviceLocationNameIndexId("service_localities", [f.countryId, f.stateId, f.cityId, f.areaId], f.localityName.toLowerCase());
    assert.equal((await db.doc(`service_location_name_indexes/${idx}`).get()).exists, false);
  } finally { await cleanup(f); }
});

test("legacy City without District remains compatible for Area save", async () => {
  const f = await fixture({ district: false });
  try {
    const result = await saveServiceLocationWithNameIndex.run(req(f.uid, "area", {
      countryId: f.countryId, stateId: f.stateId, cityId: f.cityId, name: f.areaName,
    }));
    assert.equal(result.ok, true);
    const area = await db.doc(`service_areas/${result.locationId}`).get();
    assert.equal(area.get("cityId"), f.cityId);
    const idx = serviceLocationNameIndexId("service_areas", [f.countryId, f.stateId, f.cityId], f.areaName.toLowerCase());
    assert.equal((await db.doc(`service_location_name_indexes/${idx}`).get()).get("documentId"), result.locationId);
  } finally { await cleanup(f); }
});

test("valid District-linked Area writes both legacy and District-aware name indexes", async () => {
  const f = await fixture({ district: true });
  const areaName = `Matrix-New-Area-${randomUUID()}`;
  try {
    const result = await saveServiceLocationWithNameIndex.run(req(f.uid, "area", {
      countryId: f.countryId, stateId: f.stateId, cityId: f.cityId, name: areaName,
    }));
    assert.equal(result.ok, true);
    const area = await db.doc(`service_areas/${result.locationId}`).get();
    assert.equal(area.get("cityId"), f.cityId);
    assert.equal(area.get("districtId"), undefined);
    const legacyId = serviceLocationNameIndexId("service_areas", [f.countryId, f.stateId, f.cityId], areaName.toLowerCase());
    const districtId = districtAwareNameIndexId("area", { countryId: f.countryId, stateId: f.stateId, districtId: f.districtId, cityId: f.cityId }, areaName.toLowerCase());
    assert.equal((await db.doc(`service_location_name_indexes/${legacyId}`).get()).get("documentId"), result.locationId);
    assert.equal((await db.doc(`service_location_name_indexes/${districtId}`).get()).get("documentId"), result.locationId);
    assert.deepEqual((await db.doc(`service_location_name_indexes/${districtId}`).get()).get("parentIds"), [f.countryId, f.stateId, f.districtId, f.cityId]);
    await db.doc(`service_areas/${result.locationId}`).delete();
    await db.doc(`service_location_name_indexes/${legacyId}`).delete();
  } finally { await cleanup(f); }
});

test("Locality linked to a valid District City writes both legacy and District-aware indexes", async () => {
  const f = await fixture({ district: true });
  const localityName = `Matrix-New-Locality-${randomUUID()}`;
  try {
    const result = await saveServiceLocationWithNameIndex.run(req(f.uid, "locality", {
      countryId: f.countryId, stateId: f.stateId, cityId: f.cityId,
      areaId: f.areaId, name: localityName,
    }));
    assert.equal(result.ok, true);
    const locality = await db.doc(`service_localities/${result.locationId}`).get();
    assert.equal(locality.get("areaId"), f.areaId);
    const legacyId = serviceLocationNameIndexId("service_localities", [f.countryId, f.stateId, f.cityId, f.areaId], localityName.toLowerCase());
    const districtId = districtAwareNameIndexId("locality", { countryId: f.countryId, stateId: f.stateId, districtId: f.districtId, cityId: f.cityId, areaId: f.areaId }, localityName.toLowerCase());
    assert.equal((await db.doc(`service_location_name_indexes/${legacyId}`).get()).get("documentId"), result.locationId);
    assert.equal((await db.doc(`service_location_name_indexes/${districtId}`).get()).get("documentId"), result.locationId);
    assert.deepEqual((await db.doc(`service_location_name_indexes/${districtId}`).get()).get("parentIds"), [f.countryId, f.stateId, f.districtId, f.cityId, f.areaId]);
    await db.doc(`service_localities/${result.locationId}`).delete();
    await db.doc(`service_location_name_indexes/${legacyId}`).delete();
  } finally { await cleanup(f); }
});
