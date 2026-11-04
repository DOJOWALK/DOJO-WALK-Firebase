const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PREFIX = "test_automatic_booking_" + process.pid;
let app;
let db;

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires a demo-* Firebase project.");
  assert.ok(FIRESTORE_HOST, "FIRESTORE_EMULATOR_HOST is required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production Firebase project is forbidden.");
}

// Test-only reference oracle. Isolated collections only; not imported by Functions.
async function reserveReferenceBooking(args) {
  const idempotencyRef = db.collection(PREFIX + "_idempotency").doc(args.requestKey);
  const capacityRef = db.collection(PREFIX + "_capacity").doc(args.slotId);
  const zoneRef = db.collection(PREFIX + "_zones").doc(args.zoneId);
  const walkerRef = db.collection(PREFIX + "_walkers").doc(args.walkerUid);
  const bookingRef = db.collection(PREFIX + "_bookings").doc(args.requestKey);
  const alertRef = db.collection(PREFIX + "_alerts").doc(args.requestKey);

  return db.runTransaction(async (tx) => {
    const values = await Promise.all([
      tx.get(idempotencyRef), tx.get(capacityRef), tx.get(zoneRef), tx.get(walkerRef),
    ]);
    const prior = values[0], capacity = values[1], zone = values[2], walker = values[3];
    if (prior.exists) {
      if (prior.get("payloadHash") !== args.payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_CONFLICT");
      return { outcome: "replayed", bookingId: prior.get("bookingId") };
    }
    if (!zone.exists || zone.get("workflowStatus") !== "active" ||
        zone.get("isServiceActive") !== true || zone.get("approved") !== true) {
      tx.create(alertRef, { reason: "ZONE_NOT_ELIGIBLE", createdAt: FieldValue.serverTimestamp() });
      return { outcome: "exception", reason: "ZONE_NOT_ELIGIBLE" };
    }
    if (!capacity.exists || capacity.get("remaining") < 1) {
      tx.create(alertRef, { reason: "CAPACITY_UNAVAILABLE", createdAt: FieldValue.serverTimestamp() });
      return { outcome: "unavailable", reason: "CAPACITY_UNAVAILABLE" };
    }
    if (!walker.exists || walker.get("isActive") !== true || walker.get("isApproved") !== true ||
        walker.get("zoneId") !== args.zoneId) {
      tx.create(alertRef, { reason: "WALKER_UNAVAILABLE", createdAt: FieldValue.serverTimestamp() });
      return { outcome: "exception", reason: "WALKER_UNAVAILABLE" };
    }
    const bookingId = "booking-" + args.requestKey;
    tx.update(capacityRef, { remaining: capacity.get("remaining") - 1 });
    tx.create(bookingRef, {
      bookingId: bookingId, zoneId: args.zoneId, slotId: args.slotId,
      walkerUid: args.walkerUid, status: "confirmed",
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(idempotencyRef, {
      payloadHash: args.payloadHash, bookingId: bookingId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { outcome: "confirmed", bookingId: bookingId };
  });
}

async function seed(args) {
  const zoneId = args.zoneId || "zone-a";
  const slotId = args.slotId || "slot-a";
  const walkerUid = args.walkerUid || "walker-a";
  const remaining = args.remaining === undefined ? 1 : args.remaining;
  await db.collection(PREFIX + "_zones").doc(zoneId).set({
    workflowStatus: "active", isServiceActive: true, approved: true,
  });
  await db.collection(PREFIX + "_capacity").doc(slotId).set({ remaining: remaining });
  await db.collection(PREFIX + "_walkers").doc(walkerUid).set({
    isActive: true, isApproved: true, zoneId: zoneId,
  });
}

test.before(async () => {
  assertEmulatorIsolation();
  app = initializeApp({ projectId: PROJECT_ID }, "automatic-booking-" + process.pid);
  db = getFirestore(app);
});

test.after(async () => {
  if (db) {
    const collections = ["idempotency", "capacity", "zones", "walkers", "bookings", "alerts"];
    for (const collection of collections) {
      const snap = await db.collection(PREFIX + "_" + collection).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
  }
  if (app) await deleteApp(app);
});

test("valid Active Zone processes without a Central Admin approval document", async () => {
  await seed({});
  const admin = await db.collection("admin_users").limit(1).get();
  assert.equal(admin.empty, true, "Isolated fixture must not require an Admin approval record.");
  const result = await reserveReferenceBooking({
    requestKey: "admin-offline", payloadHash: "payload-1",
    zoneId: "zone-a", slotId: "slot-a", walkerUid: "walker-a",
  });
  assert.equal(result.outcome, "confirmed");
});

test("inactive Zone fails closed and creates an exception instead of a Booking", async () => {
  await seed({ zoneId: "zone-inactive", slotId: "slot-inactive", walkerUid: "walker-inactive" });
  await db.collection(PREFIX + "_zones").doc("zone-inactive").update({ workflowStatus: "inactive" });
  const result = await reserveReferenceBooking({
    requestKey: "inactive-zone", payloadHash: "p2",
    zoneId: "zone-inactive", slotId: "slot-inactive", walkerUid: "walker-inactive",
  });
  assert.equal(result.outcome, "exception");
  assert.equal((await db.collection(PREFIX + "_bookings").doc("inactive-zone").get()).exists, false);
  assert.equal((await db.collection(PREFIX + "_alerts").doc("inactive-zone").get()).get("reason"), "ZONE_NOT_ELIGIBLE");
});

test("capacity exhaustion does not confirm a Booking", async () => {
  await seed({ zoneId: "zone-full", slotId: "slot-full", walkerUid: "walker-full", remaining: 0 });
  const result = await reserveReferenceBooking({
    requestKey: "full-slot", payloadHash: "p3",
    zoneId: "zone-full", slotId: "slot-full", walkerUid: "walker-full",
  });
  assert.equal(result.outcome, "unavailable");
  assert.equal((await db.collection(PREFIX + "_bookings").doc("full-slot").get()).exists, false);
});

test("same idempotency key and payload returns one stable Booking", async () => {
  await seed({ zoneId: "zone-idem", slotId: "slot-idem", walkerUid: "walker-idem", remaining: 2 });
  const args = {
    requestKey: "same-request", payloadHash: "same-payload",
    zoneId: "zone-idem", slotId: "slot-idem", walkerUid: "walker-idem",
  };
  const first = await reserveReferenceBooking(args);
  const replay = await reserveReferenceBooking(args);
  assert.equal(first.outcome, "confirmed");
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.bookingId, first.bookingId);
  assert.equal((await db.collection(PREFIX + "_bookings").where("zoneId", "==", "zone-idem").get()).size, 1);
});

test("same idempotency key with changed payload conflicts", async () => {
  await seed({ zoneId: "zone-conflict", slotId: "slot-conflict", walkerUid: "walker-conflict", remaining: 2 });
  const args = {
    requestKey: "changed-request", payloadHash: "original",
    zoneId: "zone-conflict", slotId: "slot-conflict", walkerUid: "walker-conflict",
  };
  await reserveReferenceBooking(args);
  await assert.rejects(
    reserveReferenceBooking({ ...args, payloadHash: "tampered" }),
    /IDEMPOTENCY_PAYLOAD_CONFLICT/,
  );
  assert.equal((await db.collection(PREFIX + "_bookings").where("zoneId", "==", "zone-conflict").get()).size, 1);
});

test("concurrent requests cannot oversell the final capacity unit", async () => {
  await seed({ zoneId: "zone-race", slotId: "slot-race", walkerUid: "walker-race", remaining: 1 });
  const results = await Promise.allSettled([
    reserveReferenceBooking({
      requestKey: "race-a", payloadHash: "race-a-payload",
      zoneId: "zone-race", slotId: "slot-race", walkerUid: "walker-race",
    }),
    reserveReferenceBooking({
      requestKey: "race-b", payloadHash: "race-b-payload",
      zoneId: "zone-race", slotId: "slot-race", walkerUid: "walker-race",
    }),
  ]);
  const confirmed = results.filter((r) => r.status === "fulfilled" && r.value.outcome === "confirmed");
  assert.equal(confirmed.length, 1);
  assert.equal((await db.collection(PREFIX + "_capacity").doc("slot-race").get()).get("remaining"), 0);
  assert.equal((await db.collection(PREFIX + "_bookings").where("zoneId", "==", "zone-race").get()).size, 1);
});

test("inactive Walker creates an exception instead of a false assignment", async () => {
  await seed({ zoneId: "zone-nowalker", slotId: "slot-nowalker", walkerUid: "walker-nowalker" });
  await db.collection(PREFIX + "_walkers").doc("walker-nowalker").update({ isActive: false });
  const result = await reserveReferenceBooking({
    requestKey: "no-walker", payloadHash: "p7",
    zoneId: "zone-nowalker", slotId: "slot-nowalker", walkerUid: "walker-nowalker",
  });
  assert.equal(result.outcome, "exception");
  assert.equal(result.reason, "WALKER_UNAVAILABLE");
  assert.equal((await db.collection(PREFIX + "_bookings").doc("no-walker").get()).exists, false);
  assert.equal((await db.collection(PREFIX + "_alerts").doc("no-walker").get()).exists, true);
});

test("unapproved Zone fails closed and does not create a Booking", async () => {
  await seed({ zoneId: "zone-not-approved", slotId: "slot-not-approved", walkerUid: "walker-not-approved" });
  await db.collection(PREFIX + "_zones").doc("zone-not-approved").update({ approved: false });
  const result = await reserveReferenceBooking({
    requestKey: "not-approved", payloadHash: "p8",
    zoneId: "zone-not-approved", slotId: "slot-not-approved", walkerUid: "walker-not-approved",
  });
  assert.equal(result.outcome, "exception");
  assert.equal(result.reason, "ZONE_NOT_ELIGIBLE");
  assert.equal((await db.collection(PREFIX + "_bookings").doc("not-approved").get()).exists, false);
});
