const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { loadOwnedBookingSourceRecords } = require("../lib/booking_source_records");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PREFIX = `booking-owner-${process.pid}`;
let app;
let db;

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires a demo-* Firebase project.");
  assert.ok(FIRESTORE_HOST, "FIRESTORE_EMULATOR_HOST is required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production Firebase project is forbidden.");
}

test.before(async () => {
  assertEmulatorIsolation();
  app = initializeApp({ projectId: PROJECT_ID }, `booking-source-owner-${process.pid}`);
  db = getFirestore(app);

  await db.doc(`users/${PREFIX}-alice/pets/alice-dog`).set({ name: "Alice Dog", fixtureOnly: true });
  await db.doc(`users/${PREFIX}-alice/addresses/alice-home`).set({ area: "Synthetic Alice Address", fixtureOnly: true });
  await db.doc(`users/${PREFIX}-bob/pets/bob-dog`).set({ name: "Bob Dog", fixtureOnly: true });
  await db.doc(`users/${PREFIX}-bob/addresses/bob-home`).set({ area: "Synthetic Bob Address", fixtureOnly: true });
});

test.after(async () => {
  if (db) {
    const paths = [
      `users/${PREFIX}-alice/pets/alice-dog`,
      `users/${PREFIX}-alice/addresses/alice-home`,
      `users/${PREFIX}-bob/pets/bob-dog`,
      `users/${PREFIX}-bob/addresses/bob-home`,
    ];
    await Promise.all(paths.map(path => db.doc(path).delete()));
  }
  if (app) await deleteApp(app);
});

test("loads pet and address from the authenticated UID namespace", async () => {
  const result = await loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "alice-dog", "alice-home");
  assert.equal(result.petRecord.name, "Alice Dog");
  assert.equal(result.addressRecord.area, "Synthetic Alice Address");
});

test("rejects another customer's pet ID without reading their record", async () => {
  await assert.rejects(
    loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "bob-dog", "alice-home"),
    /BOOKING_DOG_NOT_FOUND/,
  );
});

test("rejects another customer's saved address ID without reading their record", async () => {
  await assert.rejects(
    loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "alice-dog", "bob-home"),
    /BOOKING_ADDRESS_NOT_FOUND/,
  );
});

test("rejects missing pet or address records", async () => {
  await assert.rejects(
    loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "missing-dog", "alice-home"),
    /BOOKING_DOG_NOT_FOUND/,
  );
  await assert.rejects(
    loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "alice-dog", "missing-home"),
    /BOOKING_ADDRESS_NOT_FOUND/,
  );
});

test("rejects malformed identity values before any document lookup", async () => {
  await assert.rejects(loadOwnedBookingSourceRecords(db, "", "alice-dog", "alice-home"), /BOOKING_AUTH_UID_INVALID/);
  await assert.rejects(loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "../bob-dog", "alice-home"), /BOOKING_DOG_ID_INVALID/);
  await assert.rejects(loadOwnedBookingSourceRecords(db, `${PREFIX}-alice`, "alice-dog", ""), /BOOKING_ADDRESS_ID_INVALID/);
});
