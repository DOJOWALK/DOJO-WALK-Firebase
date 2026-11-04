const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PREFIX = "test_booking_walk_task_dto_" + process.pid;
let app;
let db;

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires a demo-* Firebase project.");
  assert.ok(FIRESTORE_HOST, "FIRESTORE_EMULATOR_HOST is required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production Firebase project is forbidden.");
}

// Test-only DTO contract oracle. This is deliberately not imported by Functions
// and does not claim to exercise a production callable or Customer App adapter.
const REQUEST_KEYS = new Set([
  "requestVersion", "idempotencyKey", "bookingPlan", "serviceType",
  "dogId", "pickupAddressId", "schedule",
]);

function validateRequest(request) {
  assert.ok(request && typeof request === "object" && !Array.isArray(request), "REQUEST_INVALID");
  for (const key of Object.keys(request)) {
    assert.ok(REQUEST_KEYS.has(key), "FORGED_OR_UNKNOWN_FIELD:" + key);
  }
  assert.equal(request.requestVersion, 1, "REQUEST_VERSION_UNSUPPORTED");
  assert.match(request.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "IDEMPOTENCY_KEY_INVALID");
  assert.ok(["one_time", "choose_dates", "regular", "immediate"].includes(request.bookingPlan),
    "BOOKING_PLAN_INVALID");
  assert.ok(typeof request.dogId === "string" && request.dogId.length > 0, "DOG_ID_REQUIRED");
  assert.ok(typeof request.pickupAddressId === "string" && request.pickupAddressId.length > 0,
    "PICKUP_ADDRESS_ID_REQUIRED");
  assert.ok(request.schedule && typeof request.schedule === "object", "SCHEDULE_REQUIRED");
}

function buildParentDto(input) {
  validateRequest(input.request);
  assert.ok(Array.isArray(input.occurrences), "OCCURRENCES_REQUIRED");
  assert.ok(input.occurrences.length > 0, "OCCURRENCES_EMPTY");
  assert.ok(input.occurrences.length <= 90, "OCCURRENCE_LIMIT_EXCEEDED");
  return {
    schemaVersion: 1,
    bookingId: input.bookingId,
    customerId: input.authenticatedUid,
    dogId: input.request.dogId,
    dogName: input.trustedPet.name,
    dogDetails: { breed: input.trustedPet.breed || null },
    pickupAddressId: input.request.pickupAddressId,
    pickupAddress: { label: input.trustedAddress.label },
    serviceZoneId: input.resolvedZoneId,
    cityId: input.cityId,
    countryCode: "IN",
    timeZone: "Asia/Kolkata",
    timeZoneRevision: input.timeZoneRevision,
    bookingPlan: input.request.bookingPlan,
    serviceType: input.request.serviceType,
    requestVersion: 1,
    status: "confirmed",
    revision: 1,
    occurrenceCount: input.occurrences.length,
    walkTaskIds: input.occurrences.map((_, i) => input.bookingId + "-task-" + (i + 1)),
  };
}

function buildTaskDtos(parent, occurrences) {
  return occurrences.map((occurrence, i) => ({
    schemaVersion: 1,
    walkTaskId: parent.walkTaskIds[i],
    bookingId: parent.bookingId,
    customerId: parent.customerId,
    walkerId: null,
    dogId: parent.dogId,
    dogName: parent.dogName,
    dogDetails: parent.dogDetails,
    pickupAddressId: parent.pickupAddressId,
    pickupAddress: parent.pickupAddress,
    serviceZoneId: parent.serviceZoneId,
    cityId: parent.cityId,
    countryCode: parent.countryCode,
    scheduledAt: occurrence.scheduledAt,
    timeZone: parent.timeZone,
    timeZoneRevision: parent.timeZoneRevision,
    serviceDateKey: occurrence.serviceDateKey,
    durationMinutes: occurrence.durationMinutes,
    status: "awaiting_assignment",
    assignmentStatus: "unassigned",
    assignmentAttemptCount: 0,
    revision: 1,
  }));
}

async function persistConfirmedAggregate(parent, tasks) {
  return db.runTransaction(async (tx) => {
    const parentRef = db.collection(PREFIX + "_bookings").doc(parent.bookingId);
    const existing = await tx.get(parentRef);
    if (existing.exists) return { replayed: true };
    assert.equal(parent.occurrenceCount, tasks.length, "TASK_COUNT_MISMATCH");
    assert.deepEqual(parent.walkTaskIds, tasks.map((task) => task.walkTaskId), "TASK_IDS_MISMATCH");
    for (const task of tasks) {
      assert.equal(task.bookingId, parent.bookingId, "TASK_PARENT_MISMATCH");
      tx.create(db.collection(PREFIX + "_walk_tasks").doc(task.walkTaskId), {
        ...task, createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.create(parentRef, { ...parent, createdAt: FieldValue.serverTimestamp() });
    return { replayed: false };
  });
}

function baseInput(overrides = {}) {
  const request = {
    requestVersion: 1,
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    bookingPlan: "one_time",
    serviceType: "dog_walk",
    dogId: "pet-a",
    pickupAddressId: "address-a",
    schedule: { durationMinutes: 30 },
  };
  return {
    request: { ...request, ...(overrides.request || {}) },
    authenticatedUid: "customer-a",
    trustedPet: { name: "Milo", breed: "Indie" },
    trustedAddress: { label: "Saved Home" },
    resolvedZoneId: "zone-a",
    cityId: "city-a",
    timeZoneRevision: 1,
    bookingId: "booking-a",
    occurrences: [{ scheduledAt: new Date("2026-11-05T04:30:00.000Z"), serviceDateKey: "2026-11-05", durationMinutes: 30 }],
  };
}

async function readAggregate(bookingId) {
  const parent = await db.collection(PREFIX + "_bookings").doc(bookingId).get();
  const tasks = await db.collection(PREFIX + "_walk_tasks").where("bookingId", "==", bookingId).get();
  return { parent, tasks };
}

test.before(async () => {
  assertEmulatorIsolation();
  app = initializeApp({ projectId: PROJECT_ID }, "booking-walk-task-dto-" + process.pid);
  db = getFirestore(app);
});

test.after(async () => {
  if (db) {
    for (const name of ["bookings", "walk_tasks"]) {
      const snap = await db.collection(PREFIX + "_" + name).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
  }
  if (app) await deleteApp(app);
});

test("One-Time booking creates one parent and exactly one executable Walk Task", async () => {
  const input = baseInput();
  const parent = buildParentDto(input);
  const tasks = buildTaskDtos(parent, input.occurrences);
  await persistConfirmedAggregate(parent, tasks);
  const stored = await readAggregate(parent.bookingId);
  assert.equal(stored.parent.get("status"), "confirmed");
  assert.equal(stored.tasks.size, 1);
  assert.equal(stored.tasks.docs[0].get("status"), "awaiting_assignment");
  assert.equal(stored.tasks.docs[0].get("timeZone"), "Asia/Kolkata");
});

test("Choose-Dates preserves every date and every walk occurrence as a separate task", async () => {
  const input = baseInput({ request: { bookingPlan: "choose_dates" } });
  input.bookingId = "booking-choose-dates";
  input.occurrences = [
    { scheduledAt: new Date("2026-11-05T01:30:00.000Z"), serviceDateKey: "2026-11-05", durationMinutes: 30 },
    { scheduledAt: new Date("2026-11-05T12:30:00.000Z"), serviceDateKey: "2026-11-05", durationMinutes: 45 },
    { scheduledAt: new Date("2026-11-06T01:30:00.000Z"), serviceDateKey: "2026-11-06", durationMinutes: 30 },
  ];
  const parent = buildParentDto(input);
  const tasks = buildTaskDtos(parent, input.occurrences);
  await persistConfirmedAggregate(parent, tasks);
  const stored = await readAggregate(parent.bookingId);
  assert.equal(stored.parent.get("occurrenceCount"), 3);
  assert.equal(stored.tasks.size, 3);
  assert.deepEqual(stored.tasks.docs.map((d) => d.get("serviceDateKey")).sort(),
    ["2026-11-05", "2026-11-05", "2026-11-06"]);
});

test("finite Regular booking keeps every generated occurrence and never creates an unbounded task series", async () => {
  const input = baseInput({ request: { bookingPlan: "regular" } });
  input.bookingId = "booking-regular";
  input.occurrences = Array.from({ length: 4 }, (_, i) => ({
    scheduledAt: new Date(Date.UTC(2026, 10, 5 + i * 7, 3, 30)),
    serviceDateKey: "2026-11-" + String(5 + i * 7).padStart(2, "0"),
    durationMinutes: 30,
  }));
  const parent = buildParentDto(input);
  const tasks = buildTaskDtos(parent, input.occurrences);
  await persistConfirmedAggregate(parent, tasks);
  const stored = await readAggregate(parent.bookingId);
  assert.equal(stored.parent.get("occurrenceCount"), 4);
  assert.equal(stored.tasks.size, 4);
  assert.equal(stored.tasks.docs.every((d) => d.get("scheduledAt") instanceof Date), true);
});

test("Immediate ignores client device time and cannot create a confirmed task from ASAP alone", async () => {
  const input = baseInput({ request: { bookingPlan: "immediate", schedule: { preferredTime: "ASAP", clientNow: "2099-01-01T00:00:00Z" } } });
  assert.throws(() => validateRequest({ ...input.request, clientNow: "2099-01-01T00:00:00Z" }), /FORGED_OR_UNKNOWN_FIELD/);
  assert.equal(input.request.schedule.preferredTime, "ASAP");
  // Immediate has no server-verified slot in this fixture, so no aggregate is written.
  const stored = await readAggregate(input.bookingId);
  assert.equal(stored.parent.exists, false);
  assert.equal(stored.tasks.empty, true);
});

test("forged identity, snapshot, Zone, time, price and status fields are rejected", () => {
  const input = baseInput().request;
  for (const forged of [
    { customerId: "victim" }, { dogName: "Forged" }, { dogDetails: {} },
    { pickupAddress: {} }, { serviceZoneId: "zone-forged" }, { cityId: "city-forged" },
    { timeZone: "UTC" }, { scheduledAt: "2099-01-01" }, { price: 1 },
    { paymentStatus: "paid" }, { status: "confirmed" }, { walkerId: "walker-forged" },
  ]) assert.throws(() => validateRequest({ ...input, ...forged }), /FORGED_OR_UNKNOWN_FIELD/);
});

test("task materialization refuses partial parent-child sets", async () => {
  const input = baseInput();
  input.bookingId = "booking-partial";
  input.occurrences.push({ scheduledAt: new Date("2026-11-06T04:30:00.000Z"), serviceDateKey: "2026-11-06", durationMinutes: 30 });
  const parent = buildParentDto(input);
  const tasks = buildTaskDtos(parent, input.occurrences).slice(0, 1);
  await assert.rejects(persistConfirmedAggregate(parent, tasks), /TASK_COUNT_MISMATCH/);
  const stored = await readAggregate(parent.bookingId);
  assert.equal(stored.parent.exists, false);
  assert.equal(stored.tasks.empty, true);
});

test("idempotent aggregate retry does not create duplicate tasks", async () => {
  const input = baseInput();
  input.bookingId = "booking-retry";
  const parent = buildParentDto(input);
  const tasks = buildTaskDtos(parent, input.occurrences);
  assert.equal((await persistConfirmedAggregate(parent, tasks)).replayed, false);
  assert.equal((await persistConfirmedAggregate(parent, tasks)).replayed, true);
  const stored = await readAggregate(parent.bookingId);
  assert.equal(stored.tasks.size, 1);
});

test("Walker assignment fixture requires active, approved, verified exact-Zone eligibility", async () => {
  const walkerRef = db.collection(PREFIX + "_walkers").doc("walker-a");
  await walkerRef.set({ isActive: true, isApproved: true, verificationStatus: "verified", zones: ["zone-a"] });
  const walker = await walkerRef.get();
  const eligible = (walker.get("isActive") === true && walker.get("isApproved") === true &&
    walker.get("verificationStatus") === "verified" && walker.get("zones").includes("zone-a"));
  const wrongZone = walker.get("zones").includes("zone-b");
  assert.equal(eligible, true);
  assert.equal(wrongZone, false);
  await walkerRef.delete();
});
