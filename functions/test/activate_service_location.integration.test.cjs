const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Requires Firestore Emulator; refusing real-project execution.");
const { getFirestore } = require("firebase-admin/firestore");
const { activateServiceLocation } = require("../lib/index");
const db = getFirestore();
const uid = `zone-contract-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
async function invoke(locationType, locationId) {
  return activateServiceLocation.run({ auth: { uid, token: { uid } }, data: { locationType, locationId } });
}
test("legacy City/Area activation callable cannot activate reference hierarchy records", async (t) => {
  const paths = [`admin_users/${uid}`, `service_cities/${uid}-city`, `service_areas/${uid}-area`];
  t.after(async () => Promise.all(paths.map(p => db.doc(p).delete().catch(() => undefined))));
  await db.doc(`admin_users/${uid}`).set({ role: "super_admin", isActive: true });
  await db.doc(`service_cities/${uid}-city`).set({ isServiceActive: false });
  await db.doc(`service_areas/${uid}-area`).set({ isServiceActive: false, cityId: `${uid}-city` });
  await assert.rejects(invoke("city", `${uid}-city`), e => e.code === "failed-precondition");
  await assert.rejects(invoke("area", `${uid}-area`), e => e.code === "failed-precondition");
  assert.equal((await db.doc(`service_cities/${uid}-city`).get()).get("isServiceActive"), false);
  assert.equal((await db.doc(`service_areas/${uid}-area`).get()).get("isServiceActive"), false);
});
test("legacy activation callable still rejects unauthenticated callers", async () => {
  await assert.rejects(activateServiceLocation.run({ auth: undefined, data: { locationType: "city", locationId: "any-city" } }), e => e.code === "unauthenticated");
});
