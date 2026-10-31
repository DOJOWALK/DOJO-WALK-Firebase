const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Requires Firestore Emulator; refusing real-project execution.");
const { getFirestore } = require("firebase-admin/firestore");
const { setServiceLocationStatus } = require("../lib/index");
const db = getFirestore();
const uid = `zone-status-contract-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
async function invoke(locationType, locationId, isActive) {
  return setServiceLocationStatus.run({ auth: { uid, token: { uid } }, data: { locationType, locationId, isActive } });
}
test("generic status callable rejects State, District and City service-status changes", async (t) => {
  const entries = [["service_states","state"],["service_districts","district"],["service_cities","city"]];
  const paths = [`admin_users/${uid}`, ...entries.map(([c,id])=>`${c}/${uid}-${id}`)];
  t.after(async () => Promise.all(paths.map(p => db.doc(p).delete().catch(() => undefined))));
  await db.doc(`admin_users/${uid}`).set({ role: "super_admin", isActive: true });
  await Promise.all(entries.map(([c,id])=>db.doc(`${c}/${uid}-${id}`).set({ isServiceActive: false, isActive: false })));
  for (const [collection,id] of entries) {
    await assert.rejects(invoke(collection === "service_states" ? "state" : collection === "service_districts" ? "district" : "city", `${uid}-${id}`, true), e => e.code === "failed-precondition");
  }
  assert.equal((await db.doc(`service_cities/${uid}-city`).get()).get("isServiceActive"), false);
});
test("generic status callable cannot activate a Zone outside Founder-approved activation workflow", async () => {
  await assert.rejects(invoke("zone", "zone-contract-test", true), e => ["failed-precondition","not-found","permission-denied"].includes(e.code));
});
test("unauthenticated status changes are rejected", async () => {
  await assert.rejects(setServiceLocationStatus.run({ auth: undefined, data: { locationType: "city", locationId: "city", isActive: true } }), e => e.code === "unauthenticated");
});
